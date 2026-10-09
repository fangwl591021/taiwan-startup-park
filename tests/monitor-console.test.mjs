import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from '../scripts/database.mjs';
import worker from '../dist/worker.js';
import {executeMeteredCall,costMicros} from '../dist/ai-meter.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',LINE_SEND_ENABLED:'off',LINE_CHANNELS_JSON:JSON.stringify({la:{channelSecret:'test-secret'},lb:{channelSecret:'test-b'}}),HTTP:async()=>{throw Error('Unexpected network request');}};
 db.sqlite.exec("INSERT INTO line_connections(id,operator_id,provider_id,channel_id,destination,enabled) VALUES('la','op-a','provider-a','ca','da',1),('lb','op-b','provider-b','cb','db',1)");
 const headers={origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'};
 async function as(id){const r=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers,body:JSON.stringify({user_id:id})}),env);const cookie=r.headers.get('set-cookie').split(';')[0];return async(path,method='GET',data)=>{const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{...headers,cookie},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);return {status:r.status,data:await r.json()};};}
 async function webhook(events,patch={}){const raw=JSON.stringify({destination:patch.destination||'da',events});const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('base64');const r=await worker.fetch(new Request('http://localhost/api/line/webhook/la',{method:'POST',headers:{'x-line-signature':patch.signature||sig},body:raw}),env);return {status:r.status,data:await r.json()};}
 const group=(id,text='想辦借址登記年約',extra={})=>({type:'message',webhookEventId:'e-'+id,timestamp:Date.now(),source:{type:'group',groupId:'C-fixture',userId:'U-fixture'},message:{type:'text',id,text},...extra});
 const actor={id:'owner-a',operator_id:'op-a',role:'operator_owner',active:1,name:'fixture'};
 async function enabled(){await webhook([group('discover')]);const row=db.sqlite.prepare('SELECT * FROM monitor_groups').get();const owner=await as('owner-a');const r=await owner('/admin/monitor/groups/'+row.id,'PATCH',{name:'虛構借址群組',enabled:true,reference:'虛構驗收',version:row.version});assert.equal(r.status,200);return row.id;}
 return {db,env,as,webhook,group,actor,enabled};
}
test('all four monitor tabs enforce owner, module and operator boundaries',async t=>{
 const {db,as,enabled}=await fixture(t),owner=await as('owner-a'),b=await as('owner-b');const gid=await enabled();
 for(const id of ['sales-a1','service-a','finance-a','platform','business-admin']){const call=await as(id);for(const tab of ['chat','usage','groups','calls'])assert.equal((await call('/admin/monitor?tab='+tab)).status,403);assert.equal((await call('/admin/monitor/group-scan','POST',{days:7})).status,403);}
 assert.equal((await b('/admin/monitor?tab=groups')).data.groups.length,0);
 assert.equal((await b('/admin/monitor/groups/'+gid,'PATCH',{name:'跨業者',enabled:false,version:2,reference:'x'})).status,409);
 assert.equal((await b('/admin/monitor/chats/c-o1')).status,404);
 assert.equal((await owner('/admin/monitor?days=365')).status,400);
 assert.equal((await owner('/admin/monitor?tab=calls&status=evil')).status,400);
 assert.equal((await owner('/admin/monitor?cursor=not-json')).status,400);
 assert.equal((await owner('/admin/monitor/group-rules','POST',{name:'x',keywords:['x'],context_words:['y'],enabled:true,operator_id:'op-b'})).status,400);
 db.sqlite.prepare("UPDATE workspace_modules SET enabled=0 WHERE operator_id='op-a' AND module='monitor'").run();assert.equal((await owner('/admin/monitor')).status,403);
});
test('verified group discovery is disabled by default, deduplicates and never creates a CRM identity',async t=>{
 const {db,as,group,webhook,enabled}=await fixture(t);
 assert.equal((await webhook([group('bad')],{signature:'invalid'})).status,401);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM monitor_groups').get().n,0);
 assert.equal((await webhook([group('bad-dest')],{destination:'wrong'})).status,400);
 await webhook([group('before')]);assert.equal(db.sqlite.prepare('SELECT enabled FROM monitor_groups').get().enabled,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM monitor_group_messages').get().n,0);
 const gid=await enabled(),event=group('actual');await webhook([event]);await webhook([event]);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM monitor_group_messages').get().n,1);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_contacts').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
 const owner=await as('owner-a');assert.equal((await owner('/admin/monitor/groups/'+gid,'PATCH',{name:'虛構群組',enabled:false,reference:'停用',version:2})).status,200);
 const stopped=group('stopped');await webhook([stopped]);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM monitor_group_messages').get().n,1);
 await owner('/admin/monitor/groups/'+gid,'PATCH',{name:'虛構群組',enabled:true,reference:'重開',version:3});await webhook([stopped]);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM monitor_group_messages').get().n,1);
 db.sqlite.prepare("UPDATE workspace_modules SET enabled=0 WHERE operator_id='op-a' AND module='monitor'").run();await webhook([group('module-off')]);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM monitor_group_messages').get().n,1);
});
test('group keyword AND context produces deduplicated candidates, scoped reviews and explicit CRM links only',async t=>{
 const {db,as,webhook,group,enabled}=await fixture(t);await enabled();const owner=await as('owner-a'),before=db.sqlite.prepare('SELECT COUNT(*) n FROM opportunities').get().n;
 const rule={name:'虛構年約商機',keywords:['借址'],context_words:['年約'],enabled:true};const id=(await owner('/admin/monitor/group-rules','POST',rule)).data.id;
 await webhook([group('keyword-only','借址'),group('context-only','年約'),group('both')]);const scan=await owner('/admin/monitor/group-scan','POST',{days:7});assert.equal(scan.data.created,1);assert.equal((await owner('/admin/monitor/group-scan','POST',{days:7})).data.created,0);
 const view=(await owner('/admin/monitor?tab=groups')).data;assert.equal(view.total,1);assert.equal(view.stats.messages,1);assert.equal(view.stats.members,1);assert.equal(view.ai_enabled,false);
 const o=view.items[0];assert.equal((await owner('/admin/monitor/opportunities/'+o.id,'PATCH',{status:'accepted',person_id:'crm-contact-contact-bb',reference:'跨業者',version:1})).status,400);
 assert.equal((await owner('/admin/monitor/opportunities/'+o.id,'PATCH',{status:'accepted',person_id:'crm-contact-contact-b1',reference:'確認需求，沿用已有會員',version:1})).status,200);
 assert.equal((await owner('/admin/monitor/opportunities/'+o.id,'PATCH',{status:'discarded',reference:'過期',version:1})).status,409);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM opportunities').get().n,before);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM ai_call_ledger').get().n,0);
 assert.equal((await owner('/admin/monitor/group-rules/'+id,'PATCH',{...rule,version:1})).status,200);assert.equal((await owner('/admin/monitor/group-rules/'+id,'PATCH',{...rule,version:1})).status,409);
 const publicLog=JSON.stringify((await owner('/activity')).data);assert(!publicLog.includes('虛構年約商機'));assert(!publicLog.includes('確認需求，沿用已有會員'));
});
test('group unsend tombstones erase content from candidates and cannot be resurrected by redelivery',async t=>{
 const {db,as,group,webhook,enabled}=await fixture(t);await enabled();const owner=await as('owner-a');await owner('/admin/monitor/group-rules','POST',{name:'測試',keywords:['借址'],context_words:['年約'],enabled:true});
 const event=group('erased','借址年約 PRIVATE-MUST-DISAPPEAR');await webhook([event]);await owner('/admin/monitor/group-scan','POST',{days:7});
 await webhook([{type:'unsend',webhookEventId:'unsend-erased',timestamp:Date.now(),source:event.source,unsend:{messageId:'erased'}}]);await webhook([event]);
 const view=(await owner('/admin/monitor?tab=groups')).data;assert.equal(view.items[0].removed,1);assert.equal(view.items[0].body,'');assert(!JSON.stringify(view).includes('PRIVATE-MUST-DISAPPEAR'));
 assert.equal(db.sqlite.prepare('SELECT body FROM monitor_group_messages').get().body,'');assert.equal((await owner('/admin/monitor/group-scan','POST',{days:7})).data.created,0);
 await webhook([{type:'unsend',webhookEventId:'before-erase',timestamp:Date.now(),source:event.source,unsend:{messageId:'before-message'}},group('before-message','借址年約 SECRET')]);assert.equal(db.sqlite.prepare("SELECT body FROM monitor_group_messages WHERE provider_message_id='before-message'").get().body,'');
});
test('leave event closes observation; stale/redelivered join cannot silently enable a group',async t=>{
 const {db,group,webhook,enabled,as}=await fixture(t);const gid=await enabled(),time=Date.now()+100;await webhook([group('leave','',{type:'leave',timestamp:time})]);
 const row=db.sqlite.prepare('SELECT * FROM monitor_groups').get();assert.equal(row.enabled,0);assert.equal(row.departed,1);
 await webhook([group('old-join','',{type:'join',timestamp:time-100})]);assert.equal(db.sqlite.prepare('SELECT departed FROM monitor_groups').get().departed,1);
 const owner=await as('owner-a');assert.equal((await owner('/admin/monitor/groups/'+gid,'PATCH',{name:'x',enabled:true,version:row.version,reference:'已離開'})).status,409);
 await webhook([group('new-join','',{type:'join',timestamp:time+100})]);assert.equal(db.sqlite.prepare('SELECT enabled FROM monitor_groups').get().enabled,0);
});
test('chat period, status, literal search, detail and keyset paging remain bounded with 1001 messages',async t=>{
 const {db,as}=await fixture(t),owner=await as('owner-a');const at=new Date().toISOString();const insert=db.sqlite.prepare("INSERT INTO messages(id,operator_id,conversation_id,actor_id,direction,body,source,status,idempotency_key,created_at,updated_at) VALUES(?,'op-a','c-o1','sales-a1','out',?,'human','simulated',?,?,?)");
 db.sqlite.exec('BEGIN');for(let i=0;i<1001;i++)insert.run('monitor-'+String(i).padStart(5,'0'),'bounded fixture '+i,'key-'+i,at,at);db.sqlite.exec('COMMIT');
 const one=(await owner('/admin/monitor?days=1&tab=chat&q=bounded&limit=30')).data;assert.equal(one.total,1001);assert.equal(one.items.length,30);
 const two=(await owner('/admin/monitor?days=1&tab=chat&q=bounded&limit=30&cursor='+encodeURIComponent(one.next_cursor))).data;assert.equal(two.items.length,30);assert(!two.items.some(r=>one.items.some(x=>x.id===r.id)));
 assert.equal((await owner('/admin/monitor?days=1&tab=chat&q=%25')).data.total,0);
 assert.equal((await owner('/admin/monitor?days=1&tab=chat&status=attention')).data.total,0);
 const detail=(await owner('/admin/monitor/chats/c-o1?days=1')).data;assert.equal(detail.items.length,100);assert.equal(detail.items[0].responder_name,'業務 S1 · 陳安');
 assert.equal((await owner('/admin/monitor?days=1&tab=chat&limit=1000')).status,400);
});
test('internal AI metering records real execution outcomes and leaves unknown pricing/tokens null',async t=>{
 const {db,env,actor,as}=await fixture(t);const meta={feature:'group_opportunity',provider:'fixture',model:'test-only'};
 assert.equal(costMicros(1000000,500000,200000,{input:1000000,output:2000000,cached:500000}),1900000);
 assert.throws(()=>costMicros(1,1,2,{input:1,output:1,cached:1}));
 const result=await executeMeteredCall(env,actor,meta,async()=>({value:'fixture result',status:'success',usage:{input:12,output:3,total:15,cached:0}}));assert.equal(result,'fixture result');
 await assert.rejects(()=>executeMeteredCall(env,actor,meta,async()=>{throw Error('SECRET-NEVER-IN-LEDGER');}));
 const owner=await as('owner-a'),u=(await owner('/admin/monitor?tab=usage')).data;assert.equal(u.total.requests,2);assert.equal(u.total.failed,1);assert.equal(u.total.total_tokens,null);assert.equal(u.total.provider_cost_micros,null);assert.equal(u.total.billable_cost_micros,null);
 const calls=(await owner('/admin/monitor?tab=calls&status=failed')).data;assert.equal(calls.total,1);assert.equal(calls.items[0].error_code,'MODEL_CALL_FAILED');assert(!JSON.stringify(calls).includes('SECRET-NEVER-IN-LEDGER'));
 assert.equal((await (await as('owner-b'))('/admin/monitor?tab=usage')).data.total.requests,0);
 assert.equal((await owner('/admin/monitor/calls','POST',{status:'success',operator_id:'op-a'})).status,404);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
});
test('metered costs use snapshots and periods; cached and failed calls never imply a customer charge',async t=>{
 const {db,env,actor,as}=await fixture(t);const pricing={version:'fixture-price-v1',input:1000000,output:2000000,cached:500000,billableInput:3000000,billableOutput:4000000,billableCached:1000000};
 const meta={feature:'chat_review',provider:'fixture',model:'test-only',pricing};
 await executeMeteredCall(env,actor,meta,async()=>({value:1,status:'success',usage:{input:1000000,output:500000,cached:200000}}));
 await executeMeteredCall(env,actor,meta,async()=>({value:2,status:'cached',usage:{input:0,output:0,cached:0}}));
 db.sqlite.prepare("UPDATE ai_call_ledger SET created_at=? WHERE status='success'").run(new Date(Date.now()-14*86400000).toISOString());const owner=await as('owner-a');
 assert.equal((await owner('/admin/monitor?tab=usage&days=7')).data.total.requests,1);
 const u=(await owner('/admin/monitor?tab=usage&days=30')).data;assert.equal(u.total.requests,2);assert.equal(u.total.provider_cost_micros,1900000);assert.equal(u.total.billable_cost_micros,4600000);assert.equal(u.billing_enabled,false);
 assert(db.sqlite.prepare('SELECT * FROM digital_revenue_terms').all().every(r=>r.platform_fee_amount===null));
});
