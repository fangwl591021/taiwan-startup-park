import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from '../scripts/database.mjs';
import worker from '../dist/worker.js';
import {decryptStoredSecret} from '../dist/line-credentials.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',LINE_SEND_ENABLED:'off',LINE_CREDENTIALS_KEY:Buffer.alloc(32,9).toString('base64')};
 const headers={origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'};
 async function as(id){const r=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers,body:JSON.stringify({user_id:id})}),env);const cookie=r.headers.get('set-cookie').split(';')[0];return async(path,method='GET',data,extra={})=>{const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{...headers,cookie,...extra},...(data&&method!=='GET'?{body:JSON.stringify(data)}:{})}),env);return{status:r.status,data:await r.json()};};}
 function line(op,id,channel){db.sqlite.prepare('INSERT INTO line_connections(id,operator_id,provider_id,channel_id,destination,name,enabled) VALUES(?,?,?,?,?,?,1)').run(id,op,'provider-'+op,channel,'U'+channel.padStart(32,'0'),'虛構 OA');}
 function contact(op,c,id,user='U'+ 'f'.repeat(32)){db.sqlite.prepare('INSERT INTO line_contacts(id,operator_id,connection_id,user_id,created_at) VALUES(?,?,?,?,?)').run(id,op,c,user,new Date().toISOString());}
 return{db,env,as,line,contact};
}
const profile={name:'虛構會員',company_name:'虛構借址企業',phone:'0900000000',email:'fixture@example.invalid',note:'測試資料'};
const caseInput={company_name:profile.company_name,title:'借址登記',owner_id:'sales-a1',amount:36000,next_action:'確認服務期間',followup_at:'',version:1,request_key:'request-fixture'};
test('CRM migration preserves contacts and inherited case/service scope; UID does not cross OA boundaries',async t=>{
 const{db,as,line,contact}=await fixture(t);line('op-a','line-a','111');line('op-b','line-b','222');contact('op-a','line-a','la');contact('op-b','line-b','lb');
 const owner=await as('owner-a'),sales=await as('sales-a1'),service=await as('service-a'),platform=await as('platform');
 const people=(await owner('/crm/people')).data.items;assert.equal(people.length,5);assert(people.some(p=>p.id==='crm-contact-contact-b4'));assert(people.some(p=>p.id==='crm-line-la'));
 assert.equal((await owner('/crm/people/crm-line-lb')).status,404);assert.equal((await sales('/crm/people/crm-line-la')).status,404);
 assert.equal((await service('/crm/people')).data.items.length,1);assert.equal((await service('/crm/people/crm-contact-contact-b1')).status,404);
 for(const p of ['/crm/people','/templates','/line/hub','/admin/risk'])assert.equal((await platform(p)).status,403);
 assert.equal((await sales('/crm/people')).data.items.length,1);assert(!JSON.stringify(people).includes('f'.repeat(32)));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM crm_line_links').get().n,2);
});
test('manual CRM to case to tenant is durable, idempotent and reuses enterprise/contact on repeat sale',async t=>{
 const{db,as}=await fixture(t),owner=await as('owner-a');const id=(await owner('/crm/people','POST',profile)).data.id;
 const before=db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n;
 const created=await owner('/crm/people/'+id+'/case','POST',caseInput);assert.equal(created.status,201);const oid=created.data.id,bid=created.data.business_id;
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n,before+1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM crm_people WHERE business_id=?').get(bid).n,1);
 assert.equal((await owner('/crm/people/'+id+'/case','POST',caseInput)).data.id,oid);
 assert.equal((await owner('/crm/people/'+id+'/case','POST',{...caseInput,amount:1})).status,409);
 assert.equal((await owner('/opportunities/'+oid,'PATCH',{version:1,stage:'onboarding'})).status,200);
 assert.equal((await owner('/opportunities/'+oid,'PATCH',{version:2,stage:'billing'})).status,200);
 assert.equal((await owner('/opportunities/'+oid+'/win','POST',{version:3})).data.business_id,bid);
 const p=(await owner('/crm/people/'+id)).data;assert.equal(p.business_id,bid);assert.equal(p.cases[0].stage,'won');
 const next=await owner('/crm/people/'+id+'/case','POST',{...caseInput,version:p.version,request_key:'second-sale'});assert.equal(next.status,201);assert.equal(next.data.business_id,bid);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n,before+1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM contacts WHERE business_id=?').get(bid).n,1);
 assert.equal((await owner('/businesses/'+bid)).data.is_tenant,1);assert.equal((await owner('/opportunities/'+oid)).data.payment_status,'unpaid');
});
test('signed LINE contact becomes CRM, attaches case and imports historical inbox without sending',async t=>{
 const{db,as,line,contact}=await fixture(t);line('op-a','line-a','111');contact('op-a','line-a','la');
 db.sqlite.prepare("INSERT INTO line_events(connection_id,event_id,operator_id,kind,user_id,provider_message_id,body,event_at,received_at,state) VALUES('line-a','fixture-e','op-a','message',?,'m-fixture','想確認借址年約',1,?,'unmatched')").run('U'+'f'.repeat(32),new Date().toISOString());
 const owner=await as('owner-a'),p=(await owner('/crm/people/crm-line-la')).data;
 const r=await owner('/crm/people/'+p.id+'/case','POST',{...caseInput,version:p.version});assert.equal(r.status,201);
 const linked=db.sqlite.prepare('SELECT conversation_id FROM line_contacts WHERE id=?').get('la').conversation_id;assert(linked);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(linked).n,1);
 assert.equal(db.sqlite.prepare('SELECT body FROM messages WHERE conversation_id=?').get(linked).body,'想確認借址年約');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
 assert.equal((await (await as('sales-a1'))('/crm/people/'+p.id)).status,200);assert.equal((await (await as('sales-a2'))('/crm/people/'+p.id)).status,404);
});
test('CRM profile CAS cannot overwrite contact on stale save; assignment and forged fields enforce authority',async t=>{
 const{db,as}=await fixture(t),owner=await as('owner-a'),sales=await as('sales-a1');const id='crm-contact-contact-b1';
 const patch={...profile,tags:['借址','年約'],status:'active',version:1};assert.equal((await owner('/crm/people/'+id,'PATCH',patch)).status,200);
 assert.equal((await owner('/crm/people/'+id,'PATCH',{...patch,name:'stale'})).status,409);assert.equal(db.sqlite.prepare('SELECT name FROM contacts WHERE id=?').get('contact-b1').name,profile.name);
 for(const extra of[{operator_id:'op-b'},{actor_id:'owner-b'},{role:'operator_owner'}])assert.equal((await owner('/crm/people','POST',{...profile,...extra})).status,400);
 assert.equal((await owner('/crm/people','POST',profile,{origin:'http://evil.invalid'})).status,403);
 const person=(await owner('/crm/people','POST',profile)).data.id;assert.equal((await sales('/crm/people/'+person)).status,404);
 assert.equal((await owner('/crm/people/'+person+'/assign','PATCH',{assigned_id:'sales-b',version:1})).status,400);
 assert.equal((await owner('/crm/people/'+person+'/assign','PATCH',{assigned_id:'sales-a1',version:1})).status,200);assert.equal((await sales('/crm/people/'+person)).status,200);
 assert.equal((await sales('/crm/people/'+person+'/case','POST',{...caseInput,owner_id:'sales-a2',version:2})).status,403);
 db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='sales-a1'").run();assert.equal((await sales('/crm/people/'+person,'PATCH',patch)).status,401);
});
test('module authority is server enforced, versioned, dependency guarded and future pricing remains NULL',async t=>{
 const{db,as}=await fixture(t),system=await as('platform'),owner=await as('owner-a');const input={enabled:false,version:1,reference:'虛構模組驗收'};
 assert.equal((await owner('/platform/modules/op-a/templates','PATCH',input)).status,403);
 assert.equal((await system('/platform/modules/op-a/crm','PATCH',input)).status,409);
 assert.equal((await system('/platform/modules/op-a/line_hub','PATCH',input)).status,200);
 assert.equal((await system('/platform/modules/op-a/crm','PATCH',input)).status,200);assert.equal((await owner('/crm/people')).status,403);assert.equal((await owner('/line/hub')).status,403);
 assert.equal((await (await as('owner-b'))('/crm/people')).status,200);assert.equal((await system('/platform/modules/op-a/crm','PATCH',{...input,enabled:true})).status,409);
 for(const m of ['website','store','line_rental','address'])assert.equal((await system('/platform/modules/op-a/'+m,'PATCH',{...input,enabled:true})).status,409);
 assert.equal((await system('/platform/modules/op-a/templates','PATCH',input)).status,200);assert.equal((await owner('/templates')).status,403);
 assert.equal((await owner('/tenants')).status,200);assert.equal((await owner('/line/inbox')).status,200);
 assert(db.sqlite.prepare('SELECT * FROM digital_revenue_terms').all().every(r=>r.platform_share_bps===null));
 db.sqlite.prepare("INSERT INTO operators VALUES('new-op','新虛構業者')").run();assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_modules WHERE operator_id=?').get('new-op').n,4);
});
test('shared and private templates have separate authority, retain drafts and never publish rich menus',async t=>{
 const{db,as}=await fixture(t),system=await as('platform'),a=await as('owner-a'),b=await as('owner-b'),sales=await as('sales-a1');
 const draft={name:'虛構私有模板',kind:'message',content:'<img src=x onerror=alert(1)>',status:'draft'};const id=(await a('/templates','POST',draft)).data.id;
 assert(!(await b('/templates')).data.items.some(t=>t.id===id));assert(!(await sales('/templates')).data.items.some(t=>t.id===id));
 assert.equal((await b('/templates/'+id,'PATCH',{...draft,version:1})).status,409);assert.equal((await sales('/templates','POST',draft)).status,403);
 assert.equal((await a('/templates/'+id,'PATCH',{...draft,status:'ready',version:1})).status,200);assert((await sales('/templates')).data.items.some(t=>t.id===id));
 const shared=(await system('/platform/templates','POST',{...draft,name:'虛構共用模板',status:'ready'})).data.id;
 assert((await b('/templates')).data.items.some(t=>t.id===shared));assert.equal((await a('/templates/'+shared,'PATCH',{...draft,version:1})).status,409);
 assert.equal((await a('/templates','POST',{...draft,kind:'rich_menu',content:'[]'})).status,400);assert.equal((await a('/templates','POST',{...draft,publish:true})).status,400);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);assert.equal((await system('/platform/templates')).data.line_publish_enabled,false);
});
test('LINE hub classifies without forwarding and encrypts Login secret separately with blank retention',async t=>{
 const{db,env,as,line,contact}=await fixture(t),owner=await as('owner-a');line('op-a','line-a','111');contact('op-a','line-a','la');
 db.sqlite.prepare("INSERT INTO line_events(connection_id,event_id,operator_id,kind,user_id,body,event_at,received_at) VALUES('line-a','kw','op-a','message',?,'我要續租',2,?)").run('U'+'f'.repeat(32),new Date().toISOString());
 assert.equal((await owner('/line/hub/routes','POST',{keyword:'續租',match_type:'contains',destination:'renewal',enabled:true})).status,201);
 assert.deepEqual((await owner('/line/hub')).data.contacts[0].destinations,['renewal']);assert.equal((await (await as('sales-a1'))('/line/hub')).status,403);
 const settings={channel_id:'333',provider_id:'11',channel_secret:'a'.repeat(32),version:1,reference:'虛構 Login 設定'};
 assert.equal((await owner('/line/hub/accounts/line-a/login','PATCH',settings)).status,200);const row=db.sqlite.prepare('SELECT * FROM operator_line_login').get();assert(!row.encrypted_secret.includes(settings.channel_secret));
 assert.equal((await decryptStoredSecret(env,'__operator_login__:op-a','line-a:333',row.encrypted_secret)).channelSecret,settings.channel_secret);
 assert.deepEqual(await decryptStoredSecret(env,'op-a','line-a',row.encrypted_secret),{});let hub=(await owner('/line/hub')).data;assert(hub.accounts[0].has_login_secret);assert(!JSON.stringify(hub).includes(settings.channel_secret));assert.equal(hub.login_enabled,false);
 assert.equal((await owner('/line/hub/accounts/line-a/login','PATCH',{...settings,channel_secret:'',version:2})).status,200);assert((await owner('/line/hub')).data.accounts[0].has_login_secret);
 assert.equal((await owner('/line/hub/accounts/line-a/login','PATCH',{...settings,channel_id:'444',channel_secret:'',version:3})).status,200);assert(!(await owner('/line/hub')).data.accounts[0].has_login_secret);
 assert.equal((await (await as('owner-b'))('/line/hub/accounts/line-a/login','PATCH',settings)).status,404);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
});
test('private monitor dedupes rule hits, records actual responder, rejects other roles and removes unsent evidence',async t=>{
 const{db,as}=await fixture(t),owner=await as('owner-a'),sales=await as('sales-a1');const token='TEST-ONLY-虛構用語';
 const msg=await sales('/conversations/c-o1/messages','POST',{body:token,idempotency_key:'private-fixture'});assert.equal(msg.status,201);
 assert.equal((await owner('/admin/risk')).data.enabled,false);
 assert.equal((await owner('/admin/risk/rules','POST',{name:'虛構規則',keywords:[token],enabled:true})).status,201);
 assert.equal((await owner('/admin/risk/scan','POST',{})).data.created,1);assert.equal((await owner('/admin/risk/scan','POST',{})).data.created,0);
 let state=(await owner('/admin/risk')).data;assert.equal(state.ai_enabled,false);assert.equal(state.events[0].responder_name,'業務 S1 · 陳安');const event=state.events[0];
 for(const id of ['sales-a1','service-a','finance-a','platform','business-admin']){const user=await as(id);for(const path of ['/admin/risk','/admin/risk/scan','/admin/risk/rules'])assert.equal((await user(path,path.endsWith('risk')?'GET':'POST',{})).status,403);}
 assert.equal((await (await as('owner-b'))('/admin/risk')).data.events.length,0);
 const activity=(await owner('/activity')).data;assert(!JSON.stringify(activity).includes('rules_scanned'));assert(!JSON.stringify(activity).includes('虛構規則'));
 assert(!JSON.stringify((await sales('/crm/people')).data).includes(token));
 assert.equal((await owner('/admin/risk/events/'+event.id,'PATCH',{status:'false_positive',version:1,reference:'虛構人工核查'})).status,200);
 assert.equal((await owner('/admin/risk/events/'+event.id,'PATCH',{status:'confirmed',version:1,reference:'stale'})).status,409);
 db.sqlite.prepare("UPDATE messages SET status='removed',body='' WHERE id=?").run(msg.data.id);state=(await owner('/admin/risk')).data;assert.equal(state.events[0].body,'');assert(!JSON.stringify(state.events).includes(token));assert.equal(state.events[0].status,'false_positive');
});
test('CRM search and keyset paging stay bounded over a thousand members',async t=>{
 const{db,as}=await fixture(t);const insert=db.sqlite.prepare("INSERT INTO crm_people(id,operator_id,assigned_id,name,source,created_at,updated_at) VALUES(?,'op-a','owner-a',?,'test',?,?)");for(let i=0;i<1001;i++){const id='paged-'+String(i).padStart(5,'0');insert.run(id,'虛構會員 '+i,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');}
 const owner=await as('owner-a');let cursor='',ids=new Set();do{const r=await owner('/crm/people?limit=50&q=虛構會員'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);assert(r.data.items.length<=50);r.data.items.forEach(p=>ids.add(p.id));cursor=r.data.next_cursor;}while(cursor);assert.equal(ids.size,1001);
 assert.equal((await owner('/crm/people?limit=500')).status,400);assert.equal((await owner('/crm/people?cursor=invalid')).status,400);
});
