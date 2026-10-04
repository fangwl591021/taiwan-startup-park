import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {database,seed} from '../scripts/database.mjs';
import {entitlements,taipeiDay} from '../dist/operations.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function request(path,method='GET',data,cookie=''){
  const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{cookie,origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 async function as(id){const r=await request('/demo/login','POST',{user_id:id});assert.equal(r.status,200);return (path,method='GET',data)=>request(path,method,data,r.cookie);}
 return {db,env,as};
}
const root='/businesses/b4/';
const receipt=(version,amount,key='receipt')=>({version,direction:'receipt',amount,reference:'虛構人工核對',request_key:key});
const state=(version,status)=>({version,status,note:'驗收原因'});
const start=taipeiDay();
const end=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function currentSubscription(a){
 const s=await a(root+'subscriptions','POST',{plan_id:'plan-crm',starts_on:start,request_key:'current-sub'});assert.equal(s.status,201);
 const b=await a(root+'invoices','POST',{kind:'digital',source_id:s.data.id,due_on:start,request_key:'current-bill'});assert.equal(b.status,201);return {s:s.data,b:b.data};
}
test('operations enforce operator, assignment, tenant, role and field isolation',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),service=await as('service-a'),finance=await as('finance-a'),sales=await as('sales-a1');
 assert.equal((await a('/businesses/bb/operations')).status,404);
 assert.equal((await sales(root+'operations')).status,404);
 assert.equal((await a('/businesses/b1/operations')).status,409);
 assert.equal((await service(root+'invoices')).status,403);
 assert.equal((await finance(root+'mail','POST',{kind:'letter',description:'x',request_key:'x'})).status,403);
 const view=(await service(root+'operations')).data;assert.equal(view.invoices,null);assert(!JSON.stringify(view).includes('"amount"'));
 assert.deepEqual((await finance(root+'operations')).data.mail,[]);
 const catalog=(await a('/operations/catalog')).data;assert.equal(catalog.locations.length,1);assert(!JSON.stringify(catalog).includes('op-b'));
 for(const id of ['platform','business-admin']){const u=await as(id);assert.equal((await u(root+'operations')).status,403);assert.equal((await u('/operations/catalog')).status,403);}
 const forged=await a(root+'mail','POST',{kind:'letter',description:'x',request_key:'forge',actor_id:'sales-b'});assert.equal(forged.status,400);
});
test('contracts validate dates, scope, activation overlap and renewal replay',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a');
 const p={location_id:'loc-a',starts_on:'2027-01-01',ends_on:'2027-12-31',amount:36000,request_key:'contract'};
 assert.equal((await a(root+'contracts','POST',{...p,starts_on:'2027-02-30'})).status,400);
 assert.equal((await a(root+'contracts','POST',{...p,location_id:'loc-b'})).status,400);
 const c=await a(root+'contracts','POST',p);assert.equal(c.status,201);
 assert.equal((await a(root+'contracts/'+c.data.id,'PATCH',{version:1,status:'active',reference:'test'})).status,409);
 const renewal={version:1,starts_on:'2027-10-01',ends_on:'2028-09-30',amount:38000,request_key:'renew-contract'};
 const r=await a(root+'contracts/contract-demo/renew','POST',renewal);assert.equal(r.status,201);
 assert.equal((await a(root+'contracts/contract-demo/renew','POST',renewal)).data.id,r.data.id);
 assert.equal((await a(root+'contracts/'+r.data.id,'PATCH',{version:1,status:'active',reference:'續約確認'})).status,200);
 assert.equal((await a(root+'contracts/'+r.data.id,'PATCH',{version:1,status:'ended',reference:'stale'})).status,409);
});
test('ending an address contract retains digital subscription and contact history',async t=>{
 const {as,db}=await fixture(t);const a=await as('owner-a');
 assert.equal((await a(root+'contracts/contract-demo','PATCH',{version:1,status:'ended',reference:'租戶退租'})).status,200);
 const v=(await a(root+'operations')).data;assert.equal(v.subscriptions.length,1);assert.equal(v.contracts[0].status,'ended');
 assert.equal(db.sqlite.prepare("SELECT count(*) n FROM contacts WHERE business_id='b4'").get().n,1);
 assert.equal((await a(root+'invoices','POST',{kind:'address',source_id:'contract-demo',due_on:start,request_key:'ended-bill'})).status,409);
});
test('receivables separate address and digital, reject commerce and duplicate sources',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a');
 const rows=(await a(root+'invoices')).data;assert.deepEqual(rows.map(r=>r.kind).sort(),['address','digital']);assert(rows.every(r=>r.net_received===0));
 assert.equal((await a(root+'invoices','POST',{kind:'commerce',source_id:'sub-demo',due_on:start,request_key:'commerce'})).status,400);
 assert.equal((await a(root+'invoices','POST',{kind:'digital',source_id:'contract-demo',due_on:start,request_key:'wrong-source'})).status,404);
 assert.equal((await a(root+'invoices','POST',{kind:'digital',source_id:'sub-demo',due_on:start,request_key:'duplicate'})).status,409);
 const sales=await as('sales-a3');assert.equal((await sales(root+'invoices')).status,200);
 assert.equal((await sales(root+'invoices/bill-digital/ledger')).status,403);
});
test('partial receipts and linked refunds are immutable, bounded and audited by actual actor',async t=>{
 const {as,db}=await fixture(t);const f=await as('finance-a');const path=root+'invoices/bill-digital/ledger';
 const r=await f(path,'POST',receipt(1,500));assert.equal(r.status,201);assert.equal(r.data.actor_id,'finance-a');
 let b=(await f(root+'invoices')).data.find(r=>r.id==='bill-digital');assert.equal(b.payment_status,'partial');assert.equal(b.balance,700);
 assert.equal((await f(path,'POST',receipt(2,701,'too-much'))).status,409);
 assert.equal((await f(path,'POST',{version:2,direction:'refund',amount:501,refund_of:r.data.id,reference:'x',request_key:'excess-refund'})).status,409);
 assert.equal((await f(path,'POST',{version:2,direction:'refund',amount:100,refund_of:'unknown',reference:'x',request_key:'unknown-refund'})).status,409);
 assert.equal((await f(path,'POST',{version:2,direction:'refund',amount:200,refund_of:r.data.id,reference:'核對退款',request_key:'refund'})).status,201);
 b=(await f(root+'invoices')).data.find(r=>r.id==='bill-digital');assert.equal(b.net_received,300);assert.equal(b.version,3);
 assert.throws(()=>db.sqlite.prepare("UPDATE ledger_entries SET amount=1 WHERE id=?").run(r.data.id),/ledger_append_only/);
 assert.throws(()=>db.sqlite.prepare("DELETE FROM ledger_entries WHERE id=?").run(r.data.id),/ledger_append_only/);
 const events=(await f('/activity?business_id=b4')).data.filter(e=>e.action==='ledger_recorded');assert.equal(events.length,2);assert(events.every(e=>e.actor_name==='財務 · 周月'));assert(db.sqlite.prepare("SELECT actor_id FROM activity_events WHERE action='ledger_recorded'").all().every(e=>e.actor_id==='finance-a'));
});
test('receipt replay succeeds after version change; changed payload cannot reuse request key',async t=>{
 const {as,db}=await fixture(t);const a=await as('owner-a'),path=root+'invoices/bill-digital/ledger',p=receipt(1,100);
 const r=await a(path,'POST',p);assert.equal(r.status,201);
 const replay=await a(path,'POST',p);assert.equal(replay.status,200);assert.equal(replay.data.id,r.data.id);
 assert.equal((await a(path,'POST',{...p,amount:101})).status,409);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM ledger_entries").get().n,1);
});
test('competing ledger versions commit only one receipt and one audit event',async t=>{
 const {as,db}=await fixture(t);const a=await as('owner-a'),path=root+'invoices/bill-digital/ledger';
 const results=await Promise.all([a(path,'POST',receipt(1,800,'first')),a(path,'POST',receipt(1,800,'second'))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal(db.sqlite.prepare("SELECT SUM(amount) n FROM ledger_entries").get().n,800);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='ledger_recorded'").get().n,1);
});
test('void requires zero net balance and blocks later receipts',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),p=root+'invoices/bill-digital';
 const receiptRow=(await a(p+'/ledger','POST',receipt(1,100))).data;
 assert.equal((await a(p,'PATCH',state(2,'void'))).status,409);
 assert.equal((await a(p+'/ledger','POST',{version:2,direction:'refund',amount:100,refund_of:receiptRow.id,reference:'全額退款',request_key:'full-refund'})).status,201);
 assert.equal((await a(p,'PATCH',state(3,'void'))).status,200);
 assert.equal((await a(p+'/ledger','POST',receipt(4,100,'after-void'))).status,409);
});
test('plan archival preserves snapshots, blocks new orders, and cannot rewrite prices',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a');
 const p={plan_id:'plan-crm',starts_on:start,request_key:'snapshot'};const s=await a(root+'subscriptions','POST',p);assert.equal(s.status,201);
 assert.equal((await a('/operations/plans/plan-crm','PATCH',{version:1,active:false})).status,200);
 assert.equal((await a(root+'subscriptions','POST',p)).data.id,s.data.id);
 assert.equal((await a(root+'subscriptions','POST',{...p,request_key:'new-archived'})).status,409);
 assert.equal((await a('/operations/plans/plan-crm','PATCH',{version:2,amount:1})).status,400);
 assert.equal((await a(root+'operations')).data.subscriptions.find(r=>r.id===s.data.id).amount,800);
});
test('paid subscription eligibility does not falsely provision a module, refunds revoke eligibility',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),{s,b}=await currentSubscription(a),p=root+'subscriptions/'+s.id;
 assert.equal((await a(p,'PATCH',state(1,'active'))).status,409);
 const r=await a(root+'invoices/'+b.id+'/ledger','POST',receipt(1,800));assert.equal(r.status,201);
 assert.equal((await a(p,'PATCH',state(1,'active'))).status,200);
 let right=(await a(root+'entitlements')).data.find(r=>r.subscription_id===s.id);assert.equal(right.commercial_eligible,true);assert.equal(right.enabled,false);assert.equal(right.usage,null);
 assert.equal((await a(root+'entitlements/crm/check')).status,503);
 assert.equal((await a(root+'invoices/'+b.id+'/ledger','POST',{version:2,direction:'refund',amount:1,refund_of:r.data.id,reference:'部分退款',request_key:'eligibility-refund'})).status,201);
 right=(await a(root+'entitlements')).data.find(r=>r.subscription_id===s.id);assert.equal(right.commercial_eligible,false);assert.equal(right.reason,'payment_required');
 assert.equal((await a(root+'entitlements/crm/check')).status,403);
});
test('trial pause/resume/cancel and inclusive Taipei expiry boundaries',async t=>{
 const {as,env}=await fixture(t);const a=await as('owner-a'),{s}=await currentSubscription(a),p=root+'subscriptions/'+s.id;
 assert.equal((await a(p,'PATCH',state(1,'trial'))).status,200);
 const actor={id:'owner-a',operator_id:'op-a',role:'operator_owner'};
 const rights=async day=>(await entitlements(env,actor,'b4',day)).find(r=>r.subscription_id===s.id);
 assert.equal((await rights(s.starts_on)).commercial_eligible,true);assert.equal((await rights(s.ends_on)).commercial_eligible,true);
 assert.equal((await rights(end(s.ends_on,1))).commercial_eligible,false);assert.equal((await rights(end(s.starts_on,-1))).commercial_eligible,false);
 assert.equal(taipeiDay(Date.parse('2026-10-04T16:00:00Z')),'2026-10-05');
 assert.equal((await a(p,'PATCH',state(2,'paused'))).status,200);
 assert.equal((await rights(start)).commercial_eligible,false);
 assert.equal((await a(p,'PATCH',state(3,'resume'))).status,200);
 assert.equal((await rights(start)).commercial_eligible,true);
 assert.equal((await a(p,'PATCH',state(4,'cancelled'))).status,200);
 assert.equal((await a(p,'PATCH',state(5,'resume'))).status,409);
});
test('overlapping subscriptions cannot become effective; renewal is a distinct pending period',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),{s}=await currentSubscription(a);
 assert.equal((await a(root+'subscriptions/'+s.id,'PATCH',state(1,'trial'))).status,200);
 const duplicate=await a(root+'subscriptions','POST',{plan_id:'plan-crm',starts_on:start,request_key:'overlap'});
 assert.equal((await a(root+'subscriptions/'+duplicate.data.id,'PATCH',state(1,'trial'))).status,409);
 const p={version:2,plan_id:'plan-crm',starts_on:end(s.ends_on,1),request_key:'renew'};
 const renewal=await a(root+'subscriptions/'+s.id+'/renew','POST',p);assert.equal(renewal.status,201);assert.equal(renewal.data.status,'pending');assert.equal(renewal.data.renewal_of,s.id);
 assert.equal((await a(root+'subscriptions/'+s.id+'/renew','POST',p)).data.id,renewal.data.id);
 assert.equal((await a(root+'subscriptions/'+s.id+'/renew','POST',{...p,starts_on:s.ends_on,request_key:'overlap-renew'})).status,409);
});
test('assigned service can receive and hand off mail with version and terminal-state protection',async t=>{
 const {as}=await fixture(t);const s=await as('service-a');
 const p={kind:'letter',description:'驗收信件',request_key:'mail'};const m=await s(root+'mail','POST',p);assert.equal(m.status,201);
 assert.equal((await s(root+'mail','POST',p)).data.id,m.data.id);
 const path=root+'mail/'+m.data.id;
 assert.equal((await s(path,'PATCH',{version:1,status:'collected',handoff_reference:'x'})).status,409);
 assert.equal((await s(path,'PATCH',{version:1,status:'ready'})).status,200);
 assert.equal((await s(path,'PATCH',{version:1,status:'collected',handoff_reference:'stale'})).status,409);
 assert.equal((await s(path,'PATCH',{version:2,status:'collected'})).status,400);
 assert.equal((await s(path,'PATCH',{version:2,status:'collected',handoff_reference:'示範領取人核對'})).status,200);
 assert.equal((await s(path,'PATCH',{version:3,status:'returned',handoff_reference:'x'})).status,409);
 const events=(await s('/activity?business_id=b4')).data.filter(e=>e.action==='mail_status_changed');assert.equal(events.length,2);assert(events.every(e=>e.actor_name==='維運 · 張青'));
});
test('maintenance resolution and financial histories respect staff role scopes',async t=>{
 const {as}=await fixture(t);const s=await as('service-a'),f=await as('finance-a'),p=root+'tickets/ticket-demo';
 assert.equal((await s(p,'PATCH',{version:1,status:'resolved'})).status,400);
 assert.equal((await s(p,'PATCH',{version:1,status:'in_progress'})).status,200);
 assert.equal((await s(p,'PATCH',{version:2,status:'resolved',resolution:'資料核對完成'})).status,200);
 assert.equal((await s(p,'PATCH',{version:3,status:'closed',resolution:'租戶確認'})).status,200);
 assert.equal((await s(p,'PATCH',{version:4,status:'open',resolution:'x'})).status,409);
 await f(root+'invoices/bill-digital/ledger','POST',receipt(1,100));
 assert(!(await s('/activity?business_id=b4')).data.some(e=>e.action==='ledger_recorded'));
 assert(!(await f('/activity?business_id=b4')).data.some(e=>e.action==='ticket_status_changed'));
});
test('schema retains previous entities and enforces foreign keys after operations migration',async t=>{
 const {db}=await fixture(t);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n,5);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM messages').get().n,5);
 assert(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='line_outbox'").get());
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.throws(()=>db.sqlite.prepare("UPDATE address_contracts SET location_id='loc-b' WHERE id='contract-demo'").run(),/FOREIGN KEY/);
});
