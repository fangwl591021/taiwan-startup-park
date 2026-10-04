import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {database,seed} from '../scripts/database.mjs';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function request(path,{method='GET',data,cookie='',host='http://localhost',origin=host,environment=env}={}){
  const r=await worker.fetch(new Request(host+'/api'+path,{method,headers:{cookie,origin,'content-type':'application/json','x-requested-with':'tsp'},...(data!==undefined?{body:JSON.stringify(data)}:{})}),environment);
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 async function as(id){const r=await request('/demo/login',{method:'POST',data:{user_id:id}});assert.equal(r.status,200);return (path,method='GET',data)=>request(path,{method,data,cookie:r.cookie});}
 return {db,env,request,as};
}
test('operator A cannot list or access B resources and mutations',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a');
 for(const path of ['/opportunities','/businesses','/tenants','/conversations','/staff','/activity']){
  const r=await a(path);assert.equal(r.status,200);assert(!JSON.stringify(r.data).includes('op-b'));assert(!JSON.stringify(r.data).includes('B 業者'));
 }
 for(const path of ['/opportunities/ob','/businesses/bb','/conversations/c-ob/messages','/activity?business_id=bb'])assert.equal((await a(path)).status,404);
 for(const [path,method,data] of [
 ['/opportunities/ob','PATCH',{version:1,stage:'billing'}],['/opportunities/ob/win','POST',{version:1}],
 ['/opportunities/ob/payment','PATCH',{version:1,payment_status:'paid',reference:'fake'}],
 ['/businesses/bb/services','POST',{module:'website'}],['/businesses/bb/assignee','PATCH',{service_owner_id:'service-a'}],
 ['/conversations/c-ob/messages','POST',{body:'x',idempotency_key:'x'}],['/staff/sales-b/status','PATCH',{active:false}]
 ])assert.equal((await a(path,method,data)).status,404);
});
test('assigned sales, service and finance have separate read/write scopes',async t=>{
 const {as}=await fixture(t);const sales=await as('sales-a1'),service=await as('service-a'),finance=await as('finance-a');
 assert.deepEqual((await sales('/opportunities')).data.map(o=>o.id),['o1']);
 assert.equal((await sales('/opportunities/o2')).status,404);
 assert.equal((await sales('/conversations/c-o2/messages')).status,404);
 assert.deepEqual((await service('/tenants')).data.map(b=>b.id),['b4']);
 assert.equal((await service('/businesses/b1')).status,404);
 assert.equal((await service('/opportunities')).status,403);
 assert.equal((await service('/conversations/c-o4/messages')).status,200);
 assert.equal((await finance('/conversations')).status,403);
 assert.equal((await finance('/opportunities/o1','PATCH',{version:1,stage:'billing'})).status,403);
 assert.equal((await finance('/opportunities/o1/payment','PATCH',{version:1,payment_status:'paid',reference:'虛構核對'})).status,200);
});
test('risk endpoint isolated and no risk data preloaded to staff; platform has no implied access',async t=>{
 const {as}=await fixture(t);
 for(const id of ['sales-a1','service-a','finance-a','platform','business-admin']){
  const user=await as(id);assert.equal((await user('/admin/risk')).status,403);
  if(['platform','business-admin'].includes(id)){for(const path of ['/businesses','/opportunities','/conversations','/activity','/staff'])assert.equal((await user(path)).status,403);}
  else{const serialized=JSON.stringify((await user('/businesses')).data);assert(!/risk|風控|告警|score/.test(serialized));}
 }
 const owner=await as('owner-a');const risk=(await owner('/admin/risk')).data;
 assert.deepEqual(risk.events,[]);assert.equal(risk.enabled,false);
});
test('client cannot forge actor, operator, role, AI source or ownership',async t=>{
 const {as}=await fixture(t);const s=await as('sales-a1');
 for(const extra of [{actor_id:'owner-a'},{operator_id:'op-b'},{role:'operator_owner'},{source:'ai_auto'}])
 assert.equal((await s('/conversations/c-o1/messages','POST',{body:'test',idempotency_key:'forge',...extra})).status,400);
 assert.equal((await s('/opportunities','POST',{business_name:'fake',contact_name:'test',title:'test',owner_id:'sales-a2'})).status,403);
 assert.equal((await s('/opportunities/o1','PATCH',{version:1,owner_id:'sales-b'})).status,400);
});
test('create business/contact/opportunity, filter search and persist across sessions',async t=>{
 const {as,db}=await fixture(t);const a=await as('owner-a');
 const r=await a('/opportunities','POST',{business_name:'測試新企業',contact_name:'測試窗口',title:'官網加購',registration_no:'12345678',amount:12000,owner_id:'sales-a1',next_action:'安排試用'});
 assert.equal(r.status,201);
 const s=await as('sales-a1');const found=await s('/opportunities?q='+encodeURIComponent('測試新企業')+'&stage=contact');
 assert.equal(found.data.length,1);assert.equal(found.data[0].id,r.data.id);
 const detail=await s('/opportunities/'+r.data.id);assert.equal(detail.data.contacts[0].name,'測試窗口');
 const before=db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n;
 assert.equal((await a('/opportunities','POST',{business_name:'重複',contact_name:'test',title:'test',registration_no:'12345678'})).status,409);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n,before);
});
test('stage, version and lost reason validation; stale writes rejected',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a');
 assert.equal((await a('/opportunities/o1','PATCH',{version:1,stage:'won'})).status,400);
 assert.equal((await a('/opportunities/o1','PATCH',{version:1,stage:'lost'})).status,400);
 assert.equal((await a('/opportunities/o1/win','POST',{version:1})).status,409);
 assert.equal((await a('/opportunities/o1','PATCH',{version:1,stage:'onboarding'})).status,200);
 assert.equal((await a('/opportunities/o1','PATCH',{version:1,stage:'billing'})).status,409);
 assert.equal((await a('/opportunities/o1','PATCH',{version:2,stage:'lost',note:'暫無需求'})).status,200);
 const ev=(await a('/activity?business_id=b1')).data;
 assert.equal(ev.filter(e=>e.action==='opportunity_updated').length,2);
});
test('win is idempotent and a second opportunity reuses same tenant/contact; payment independent',async t=>{
 const {as,db}=await fixture(t);const a=await as('owner-a');
 const first=await a('/opportunities/o3/win','POST',{version:1});assert.equal(first.status,200);
 assert.equal((await a('/opportunities/o3/win','POST',{version:1})).data.already_won,true);
 const won=(await a('/opportunities/o3')).data;assert.equal(won.stage,'won');assert.equal(won.payment_status,'unpaid');
 assert.equal((await a('/businesses/b3')).data.services.length,0);
 const r=await a('/opportunities','POST',{business_id:'b3',title:'官網加購'});
 assert.equal(r.status,201);await a('/opportunities/'+r.data.id,'PATCH',{version:1,stage:'billing'});
 await a('/opportunities/'+r.data.id+'/win','POST',{version:2});
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM businesses WHERE id='b3'").get().n,1);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM contacts WHERE business_id='b3'").get().n,1);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='opportunity_won' AND opportunity_id='o3'").get().n,1);
 assert.equal((await a('/opportunities/o3','PATCH',{version:2,stage:'contact'})).status,400);
});
test('S1 assigns, S2 replies, S3 takes over; historical actor remains S2',async t=>{
 const {as,db}=await fixture(t);const s1=await as('sales-a1'),s2=await as('sales-a2'),s3=await as('sales-a3'),a=await as('owner-a');
 assert.equal((await s1('/opportunities/o1','PATCH',{version:1,owner_id:'sales-a2'})).status,200);
 assert.equal((await s1('/conversations/c-o1/messages')).status,404);
 const sent=await s2('/conversations/c-o1/messages','POST',{body:'由 S2 接洽',idempotency_key:'s2-one'});assert.equal(sent.status,201);
 assert.equal((await s2('/opportunities/o1','PATCH',{version:2,owner_id:'sales-a3'})).status,200);
 const rows=(await s3('/conversations/c-o1/messages')).data;assert.equal(rows.at(-1).actor_id,'sales-a2');assert.equal(rows.at(-1).source,'human');
 assert.equal(db.sqlite.prepare("SELECT first_agent_id FROM conversations WHERE id='c-o1'").get().first_agent_id,'sales-a2');
 const events=(await a('/activity?business_id=b1')).data;
 assert(events.find(e=>e.action==='assignment_changed'&&e.actor_name.includes('S1')));
 assert(events.find(e=>e.action==='assignment_changed'&&e.actor_name.includes('S2')));
});
test('failed message stays failed; retry and idempotency never duplicate visible messages',async t=>{
 const {as}=await fixture(t);const s=await as('sales-a1');
 const payload={body:'測試失敗與重試',idempotency_key:'unique-key',simulate_failure:true};
 const sent=await s('/conversations/c-o1/messages','POST',payload);assert.equal(sent.data.status,'failed');
 assert.equal((await s('/conversations/c-o1/messages','POST',payload)).data.id,sent.data.id);
 assert.equal((await s('/conversations/c-o1/messages','POST',{...payload,body:'different'})).status,409);
 const retry='/conversations/c-o1/messages/'+sent.data.id+'/retry';
 assert.equal((await s(retry,'POST',{})).data.status,'simulated');
 assert.equal((await s(retry,'POST',{})).data.status,'simulated');
 const messages=(await s('/conversations/c-o1/messages')).data;assert.equal(messages.filter(m=>m.id===sent.data.id).length,1);
 assert.equal(messages.at(-1).status,'simulated');assert.notEqual(messages.at(-1).status,'delivered');
});
test('service requests cannot activate integrations, are idempotent and cancellable; assigned service access',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),s=await as('sales-a3'),service=await as('service-a');
 assert.equal((await a('/businesses/b1/services','POST',{module:'website'})).status,409);
 const r=await s('/businesses/b4/services','POST',{module:'line'});assert.equal(r.status,201);assert.equal(r.data.status,'requested');
 assert.equal((await s('/businesses/b4/services','POST',{module:'line'})).data.id,r.data.id);
 assert.equal((await s('/businesses/b4/services/'+r.data.id,'PATCH',{status:'active'})).status,400);
 assert.equal((await service('/businesses/b4/services/'+r.data.id,'PATCH',{status:'cancelled'})).status,200);
 await a('/opportunities/o3/win','POST',{version:1});
 assert.equal((await service('/businesses/b3')).status,404);
 assert.equal((await a('/businesses/b3/assignee','PATCH',{service_owner_id:'service-a'})).status,200);
 assert.equal((await service('/businesses/b3')).status,200);
 assert.equal((await a('/businesses/b3/assignee','PATCH',{service_owner_id:'sales-b'})).status,400);
});
test('revoked session cannot write and attribution remains',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),s=await as('sales-a1');
 await s('/conversations/c-o1/messages','POST',{body:'停權前回覆',idempotency_key:'before-disable'});
 assert.equal((await a('/staff/sales-a1/status','PATCH',{active:false})).status,200);
 assert.equal((await s('/opportunities/o1','PATCH',{version:1,stage:'billing'})).status,401);
 assert.equal((await s('/conversations/c-o1/messages','POST',{body:'no',idempotency_key:'after'})).status,401);
 assert.equal((await a('/conversations/c-o1/messages')).data.at(-1).actor_id,'sales-a1');
});
test('production and remote hosts fail closed, including existing local sessions; CSRF blocked',async t=>{
 const {request,env}=await fixture(t);
 const login=await request('/demo/login',{method:'POST',data:{user_id:'owner-a'}});
 for(const environment of [{...env,APP_ENV:'production'},{...env,DEMO_MODE:'off'}]){
  assert.equal((await request('/demo/login',{method:'POST',data:{user_id:'owner-a'},environment})).status,404);
  assert.equal((await request('/me',{cookie:login.cookie,environment})).status,503);
  assert.equal((await request('/bootstrap',{environment})).data.demo,false);
 }
 assert.equal((await request('/demo/users',{host:'https://example.com'})).status,404);
 assert.equal((await request('/me',{host:'https://example.com',cookie:login.cookie})).status,503);
 assert.equal((await request('/opportunities/o1',{method:'PATCH',cookie:login.cookie,origin:'https://evil.example',data:{version:1,stage:'billing'}})).status,403);
 assert.equal((await request('/me')).status,401);
});
test('database adapter batch rolls back and schema enforces cross-operator foreign keys',async t=>{
 const {db}=await fixture(t);
 await assert.rejects(db.batch([
 db.prepare('INSERT INTO businesses(id,operator_id,name,created_at) VALUES(?,?,?,?)').bind('rollback','op-a','rollback','2026-10-04'),
 db.prepare('INSERT INTO contacts(id,operator_id,business_id,name) VALUES(?,?,?,?)').bind('bad','op-b','rollback','bad')
 ]));
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM businesses WHERE id='rollback'").get().n,0);
});
test('competing version writes produce one change and one event',async t=>{
 const {as,db}=await fixture(t);const a=await as('owner-a');
 const outcomes=await Promise.all([a('/opportunities/o1','PATCH',{version:1,next_action:'first'}),a('/opportunities/o1','PATCH',{version:1,next_action:'second'})]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM activity_events WHERE opportunity_id='o1' AND action='opportunity_updated'").get().n,1);
});
