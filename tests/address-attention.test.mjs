import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {addressAttention} from '../dist/address-attention.js';
import {database,seed} from '../scripts/database.mjs';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function as(id){
  const login=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},body:JSON.stringify({user_id:id})}),env);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return async()=>{const r=await worker.fetch(new Request('http://localhost/api/dashboard',{headers:{cookie}}),env);return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};};
 }
 const attention=(time=Date.parse('2026-10-08T00:00:00Z'))=>addressAttention(env,{id:'owner-a',operator_id:'op-a',role:'operator_owner'},{sql:'b.operator_id=?',args:['op-a']},time);
 return {db,as,attention};
}
function contract(db,id,start,end,status='active',renewal=null){
 db.sqlite.prepare("INSERT INTO address_contracts(id,operator_id,business_id,location_id,starts_on,ends_on,amount,status,actor_id,request_key,request_hash,created_at,updated_at,renewal_of) VALUES(?,'op-a','b4','loc-a',?,?,36000,?,'owner-a',?,'fixture','2026-10-01','2026-10-01',?)").run(id,start,end,status,id,renewal);
}
test('attention uses Taipei dates, includes today and 30-day boundary, excludes future starts and ended contracts',async t=>{
 const {db,attention}=await fixture(t);
 db.sqlite.prepare("DELETE FROM receivables WHERE contract_id='contract-demo'").run();db.sqlite.prepare("DELETE FROM address_contracts WHERE id='contract-demo'").run();
 contract(db,'expired','2026-09-01','2026-09-29');contract(db,'today','2026-10-01','2026-10-08');
 contract(db,'boundary','2026-10-10','2026-11-07','draft');
 // Activate an already-started separate location to avoid overlapping active contracts.
 db.sqlite.prepare("INSERT INTO locations(id,operator_id,name,address,created_at) VALUES('loc-edge','op-a','边界示範','虛構','2026-10-01')").run();
 db.sqlite.prepare("UPDATE address_contracts SET location_id='loc-edge',starts_on='2026-10-01',status='active' WHERE id='boundary'").run();
 contract(db,'future','2026-10-10','2026-10-20');contract(db,'ended','2026-08-01','2026-08-31','ended');
 let r=await attention();assert.deepEqual(r.groups.contracts.items.map(x=>x.id),['expired','today','boundary']);
 assert.equal(r.groups.contracts.items[0].period_status,'expired');assert.equal(r.groups.contracts.items[1].period_status,'expiring');
 r=await attention(Date.parse('2026-10-07T15:59:59Z'));assert.equal(r.as_of,'2026-10-07');assert.equal(r.through,'2026-11-06');assert(!r.groups.contracts.items.some(x=>x.id==='boundary'));
 assert.equal((await attention(Date.parse('2026-10-07T16:00:00Z'))).as_of,'2026-10-08');
});
test('only confirmed contiguous renewal removes an old expiry; drafts and gaps retain it',async t=>{
 const {db,attention}=await fixture(t);db.sqlite.prepare("UPDATE address_contracts SET ends_on='2026-10-10' WHERE id='contract-demo'").run();
 contract(db,'next','2026-10-11','2027-10-10','draft','contract-demo');
 assert.equal((await attention()).groups.contracts.total,1);
 db.sqlite.prepare("UPDATE address_contracts SET status='active' WHERE id='next'").run();assert.equal((await attention()).groups.contracts.total,0);
 db.sqlite.prepare("UPDATE address_contracts SET starts_on='2026-10-12' WHERE id='next'").run();assert.equal((await attention()).groups.contracts.total,1);
});
test('overdue address balances follow partial receipts and refunds; paid, void, digital and today are excluded',async t=>{
 const {db,attention}=await fixture(t);
 db.sqlite.prepare("UPDATE receivables SET due_on='2026-10-07'").run();
 const record=(id,direction,amount,refund=null)=>db.sqlite.prepare("INSERT INTO ledger_entries(id,operator_id,business_id,receivable_id,direction,amount,refund_of,reference,actor_id,request_key,request_hash,created_at) VALUES(?,'op-a','b4','bill-address',?,?,?,'private-proof','owner-a',?,'fixture','2026-10-07')").run(id,direction,amount,refund,id);
 record('receipt','receipt',10000);assert.equal((await attention()).groups.invoices.items[0].balance,26000);
 record('final','receipt',26000);assert.equal((await attention()).groups.invoices.total,0);
 record('refund','refund',1000,'receipt');const r=await attention();assert.equal(r.groups.invoices.total,1);assert.equal(r.groups.invoices.items[0].balance,1000);assert(!JSON.stringify(r).includes('private-proof'));assert(!JSON.stringify(r).includes('bill-digital'));
 db.sqlite.prepare("UPDATE receivables SET due_on='2026-10-08' WHERE id='bill-address'").run();assert.equal((await attention()).groups.invoices.total,0);
 record('rest-refund','refund',9000,'receipt');record('final-refund','refund',26000,'final');
 db.sqlite.prepare("UPDATE receivables SET due_on='2026-10-07',status='void' WHERE id='bill-address'").run();assert.equal((await attention()).groups.invoices.total,0);
});
test('dashboard attention preserves assignment and role boundaries with no hidden amounts, mail or cross-operator names',async t=>{
 const {db,as}=await fixture(t);db.sqlite.prepare("UPDATE receivables SET due_on='2000-01-01'").run();
 const owner=await (await as('owner-a'))();assert.equal(owner.cache,'no-store');assert.equal(owner.data.attention.groups.invoices.total,1);
 const service=(await (await as('service-a'))()).data.attention;assert.equal(service.groups.invoices,null);assert(!JSON.stringify(service).includes('balance'));assert.equal(service.groups.mail.total,1);
 const finance=(await (await as('finance-a'))()).data.attention;assert.equal(finance.groups.mail,null);assert.equal(finance.groups.tickets,null);
 const hidden=(await (await as('sales-a1'))()).data.attention;assert.equal(hidden.groups.mail.total,0);assert.equal(hidden.groups.invoices.total,0);
 const assigned=(await (await as('sales-a3'))()).data.attention;assert.equal(assigned.groups.mail.total,1);
 const other=(await (await as('owner-b'))()).data.attention;assert(!JSON.stringify(other).includes('青鳥'));assert.equal(other.groups.mail.total,0);
 for(const id of ['platform','business-admin'])assert.equal((await (await as(id))()).status,403);
 db.sqlite.prepare("UPDATE businesses SET service_owner_id='owner-a' WHERE id='b4'").run();assert.equal((await (await as('service-a'))()).data.attention.groups.mail.total,0);
});
test('mail and tickets disappear when completed and counts stay accurate beyond the bounded list',async t=>{
 const {db,attention}=await fixture(t);
 const insert=db.sqlite.prepare("INSERT INTO mail_items(id,operator_id,business_id,kind,description,actor_id,request_key,request_hash,created_at,updated_at) VALUES(?,'op-a','b4','letter','private-description','owner-a',?,'fixture','2026-10-01','2026-10-01')");
 for(let i=0;i<15;i++)insert.run('mail-'+i,'mail-'+i);
 const r=await attention();assert.equal(r.groups.mail.total,16);assert.equal(r.groups.mail.items.length,10);assert(!JSON.stringify(r).includes('private-description'));
 db.sqlite.prepare("UPDATE mail_items SET status='collected'").run();db.sqlite.prepare("UPDATE maintenance_tickets SET status='closed'").run();assert.equal((await attention()).groups.mail.total,0);assert.equal((await attention()).groups.tickets.total,0);
});
