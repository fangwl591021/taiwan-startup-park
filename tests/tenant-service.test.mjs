import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {database,seed} from '../scripts/database.mjs';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function as(id){
  const login=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},body:JSON.stringify({user_id:id})}),env);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return async(path,method='GET',data)=>{
   const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{cookie,origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
   return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};
  };
 }
 return {db,as};
}
const root='/businesses/b4/';
test('legacy service summary preserves unknown terms and masks money per assignment and role',async t=>{
 const {db,as}=await fixture(t),owner=await as('owner-a');
 const summary=await owner(root+'service-summary');assert.equal(summary.status,200);assert.equal(summary.cache,'no-store');
 const c=summary.data.contracts[0];assert.equal(c.id,'contract-demo');assert.equal(c.term_kind,null);assert.equal(c.payment_cycle,null);assert.equal(c.mail_service,null);assert.equal(c.starts_on,'2026-10-01');assert.equal(c.ends_on,'2027-09-30');
 assert.equal(summary.data.digital.enabled,false);assert.equal(summary.data.digital.pricing,'unagreed');assert.equal(summary.data.digital_records[0].starts_on,'2026-10-01');
 for(const user of ['service-a','finance-a','sales-a1','owner-b','platform','business-admin']){
  const read=await as(user),r=await read(root+'service-summary');
  assert.equal(r.status,user==='service-a'||user==='finance-a'?200:['platform','business-admin'].includes(user)?403:404);
  if(user==='service-a')assert(!JSON.stringify(r.data).includes('"amount"'));
 }
 assert(!JSON.stringify(summary.data).includes('request_hash'));assert(!JSON.stringify(summary.data).includes('request_key'));
 db.sqlite.prepare("INSERT INTO businesses(id,operator_id,name,is_tenant,created_at) VALUES('empty-tenant','op-a','無合約企業',1,'2026-10-06T00:00:00Z')").run();
 const empty=await owner('/businesses/empty-tenant/service-summary');assert.deepEqual(empty.data.contracts,[]);
});
test('explicit term and collection cycle are independent, validate enums, persist through renewal and audit operator',async t=>{
 const {db,as}=await fixture(t),owner=await as('owner-a');
 const path=root+'contracts/contract-demo/terms';
 const data={version:1,term_kind:'annual',payment_cycle:'monthly',mail_service:'included',note:'依虛構年約約定，按月人工核對'};
 assert.equal((await owner(path,'PATCH',{...data,payment_cycle:'invalid'})).status,400);
 assert.equal((await owner(path,'PATCH',{...data,amount:1})).status,400);
 assert.equal((await owner(path,'PATCH',{...data,operator_id:'op-b'})).status,400);
 assert.equal((await owner(path,'PATCH',data)).status,200);
 const c=(await owner(root+'service-summary')).data.contracts[0];assert.equal(c.term_kind,'annual');assert.equal(c.payment_cycle,'monthly');assert.equal(c.mail_service,'included');
 assert.equal(c.amount,36000);assert.equal(c.starts_on,'2026-10-01');assert.equal(c.ends_on,'2027-09-30');
 assert.equal((await owner(path,'PATCH',data)).status,409);
 const history=db.sqlite.prepare("SELECT actor_id FROM activity_events WHERE action='contract_terms_changed'").all();assert.deepEqual(history.map(r=>r.actor_id),['owner-a']);
 const renewal={version:2,starts_on:'2027-10-01',ends_on:'2028-09-30',amount:38000,request_key:'terms-renewal'};
 const r=await owner(root+'contracts/contract-demo/renew','POST',renewal);assert.equal(r.status,201);assert.equal(r.data.payment_cycle,'monthly');assert.equal(r.data.term_kind,'annual');assert.equal(r.data.mail_service,'included');
 assert.equal((await owner(root+'contracts/contract-demo/renew','POST',renewal)).data.id,r.data.id);
 assert.equal(db.sqlite.prepare("SELECT amount FROM receivables WHERE id='bill-address'").get().amount,36000);
});
test('contract terms are owner-only, versioned and closed contracts stay read-only',async t=>{
 const {as}=await fixture(t);
 for(const id of ['service-a','finance-a','sales-a3']){
  const actor=await as(id);assert.equal((await actor(root+'contracts/contract-demo/terms','PATCH',{version:1,term_kind:'annual',note:'越權嘗試'})).status,403);
 }
 const owner=await as('owner-a');assert.equal((await owner(root+'contracts/contract-demo','PATCH',{version:1,status:'ended',reference:'虛構终止依據'})).status,200);
 assert.equal((await owner(root+'contracts/contract-demo/terms','PATCH',{version:2,term_kind:'annual',note:'不可覆寫'})).status,409);
 const list=(await owner('/tenants?paged=1')).data.items.find(b=>b.id==='b4');assert.equal(list.contract_status,'ended');assert.equal(list.service_ends_on,'2027-09-30');assert(!('amount' in list));
});
test('summary caps historical records and paged lists use the actual representative contract',async t=>{
 const {db,as}=await fixture(t),owner=await as('owner-a');
 for(let i=0;i<20;i++)db.sqlite.prepare("INSERT INTO address_contracts(id,operator_id,business_id,location_id,starts_on,ends_on,amount,status,actor_id,request_key,request_hash,created_at,updated_at) VALUES(?, 'op-a','b4','loc-a','2025-01-01','2025-12-31',1,'ended','owner-a',?,'test','2026-10-06','2026-10-06')").run('old-'+i,'old-key-'+i);
 const summary=(await owner(root+'service-summary')).data;assert.equal(summary.contracts.length,5);assert.equal(summary.contracts[0].id,'contract-demo');
 const list=(await owner('/tenants?paged=1&limit=1')).data.items[0];assert.equal(list.contract_status,'active');assert.equal(list.service_starts_on,'2026-10-01');
 db.sqlite.prepare("UPDATE address_contracts SET status='ended' WHERE id='contract-demo'").run();
 for(const year of [2028,2029])db.sqlite.prepare("INSERT INTO address_contracts(id,operator_id,business_id,location_id,starts_on,ends_on,amount,status,actor_id,request_key,request_hash,created_at,updated_at) VALUES(?,'op-a','b4','loc-a',?,?,1,'active','owner-a',?,'test','2026-10-06','2026-10-06')").run('future-'+year,year+'-01-01',year+'-12-31','future-key-'+year);
 const scheduled=(await owner(root+'service-summary')).data.contracts[0];assert.equal(scheduled.starts_on,'2028-01-01');
 const next=(await owner('/tenants?paged=1&limit=1')).data.items[0];assert.equal(next.service_starts_on,'2028-01-01');
 const plan=db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM address_contracts WHERE operator_id='op-a' AND business_id='b4' ORDER BY status,ends_on DESC,id DESC").all();assert(plan.some(r=>r.detail.includes('address_contracts_service_lookup')));
});
