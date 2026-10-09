import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../dist/worker.js';
import {database,seed} from '../scripts/database.mjs';
import {digitalPreview} from '../dist/scope.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function as(id){
  const login=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},body:JSON.stringify({user_id:id})}),env);
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  return async(path,method='GET',data)=>{
   const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{cookie,origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
   return {status:r.status,data:await r.json()};
  };
 }
 return {db,env,as};
}
test('phase one is the default and preview cannot enable remote digital sales',async t=>{
 const {as,env}=await fixture(t);const owner=await as('owner-a');
 assert.equal((await owner('/me')).data.digital_preview,false);
 assert.equal((await owner('/operations/catalog')).data.phase,'address_only');
 for(const APP_ENV of ['production','sandbox','staging',undefined])assert.equal(digitalPreview({...env,APP_ENV,DIGITAL_PREVIEW:'on'}),false);
 assert.equal(digitalPreview({...env,DIGITAL_PREVIEW:'on'}),true);
});
test('digital commercial writes, request creation and entitlement are blocked without changing retained history',async t=>{
 const {as,db}=await fixture(t),owner=await as('owner-a');
 const before=JSON.stringify(db.sqlite.prepare('SELECT * FROM subscriptions').all());
 const cases=[
 ['/operations/plans','POST',{name:'x',module:'website',amount:1,duration_days:30,quota_limit:0}],
 ['/operations/plans/plan-crm','PATCH',{active:false,version:1}],
 ['/businesses/b4/subscriptions','POST',{plan_id:'plan-crm',starts_on:'2028-01-01',request_key:'blocked-sub'}],
 ['/businesses/b4/subscriptions/sub-demo','PATCH',{version:1,status:'trial',note:'x'}],
 ['/businesses/b4/subscriptions/sub-demo/renew','POST',{version:1,plan_id:'plan-web',starts_on:'2028-01-01',request_key:'blocked-renew'}],
 ['/businesses/b4/invoices','POST',{kind:'digital',source_id:'sub-demo',due_on:'2028-01-01',request_key:'blocked-bill'}],
 ['/businesses/b4/invoices/bill-digital/ledger','POST',{version:1,direction:'receipt',amount:1,reference:'x',request_key:'blocked-money'}],
 ['/businesses/b4/invoices/bill-digital','PATCH',{version:1,status:'void',note:'x'}],
 ['/businesses/b4/services','POST',{module:'website'}]
 ];
 for(const [p,m,d] of cases)assert.equal((await owner(p,m,d)).status,409,p);
 assert.equal((await owner('/businesses/b4/entitlements/website/check')).status,409);
 assert.equal((await owner('/businesses/b4/entitlements')).data[0].commercial_eligible,false);
 assert.equal((await owner('/businesses/b4/entitlements')).data[0].reason,'phase_one_only');
 assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM subscriptions').all()),before);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n,0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM activity_events WHERE action IN('plan_created','subscription_created','ledger_recorded')").get().n,0);
 assert.equal((await owner('/businesses/bb/subscriptions','POST',{})).status,404);
});
test('unagreed terms are NULL, read-only, scoped by server operator and absent from ordinary catalog',async t=>{
 const {as,db}=await fixture(t),owner=await as('owner-a');
 const r=await owner('/operations/revenue-terms');assert.equal(r.status,200);
 assert.equal(r.data.settlement_enabled,false);assert.equal(r.data.terms.length,4);
 for(const row of r.data.terms){assert.equal(row.status,'unagreed');for(const key of Object.keys(row).filter(k=>!['module','status'].includes(k)))assert.equal(row[key],null,key);}
 for(const id of ['sales-a1','service-a','finance-a','platform','business-admin'])assert.equal((await (await as(id))('/operations/revenue-terms')).status,403);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await owner('/operations/revenue-terms',method,{operator_id:'op-b',platform_share_bps:4000})).status,409);
 assert(!JSON.stringify((await owner('/operations/catalog')).data).includes('platform_share_bps'));
 // Populate a separate B agreement only as a database isolation fixture, never a default.
 db.sqlite.prepare("UPDATE digital_revenue_terms SET status='agreed',partner_name='B-private-fixture',settlement_basis='net_collected',platform_share_bps=2500,operator_share_bps=7500,settlement_cycle='monthly',effective_on='2028-01-01',agreement_reference='B-private-reference' WHERE operator_id='op-b' AND module='website'").run();
 assert(!JSON.stringify((await owner('/operations/revenue-terms')).data).includes('B-private'));
 assert((await (await as('owner-b'))('/operations/revenue-terms')).data.terms.some(t=>t.partner_name==='B-private-fixture'));
 assert.throws(()=>db.sqlite.prepare("UPDATE digital_revenue_terms SET platform_share_bps=0 WHERE operator_id='op-a' AND module='website'").run(),/CHECK/);
});
test('migration backfills existing operators, adds blank terms for new operators, preserves address and digital history',async t=>{
 const {db}=await fixture(t);
 const contracts=db.sqlite.prepare('SELECT COUNT(*) n FROM address_contracts').get().n;
 const subscriptions=db.sqlite.prepare('SELECT COUNT(*) n FROM subscriptions').get().n;
 db.sqlite.exec('DROP TRIGGER digital_terms_new_operator; DROP TABLE digital_revenue_terms;');
 db.sqlite.exec(readFileSync(new URL('../migrations/0004_digital_revenue_placeholders.sql',import.meta.url),'utf8'));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM digital_revenue_terms').get().n,8);
 db.sqlite.prepare('INSERT INTO operators(id,name) VALUES(?,?)').run('op-new','新增虛構業者');
 const terms=db.sqlite.prepare("SELECT * FROM digital_revenue_terms WHERE operator_id='op-new'").all();
 assert.equal(terms.length,4);assert(terms.every(r=>r.platform_share_bps===null&&r.operator_share_bps===null&&r.platform_fee_amount===null));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM address_contracts').get().n,contracts);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,subscriptions);
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('phase-one address contract, receivable, partial receipt, refund, renewal and actor history remain usable',async t=>{
 const {as,db}=await fixture(t),owner=await as('owner-a'),finance=await as('finance-a');
 const base='/businesses/b4/';
 const c=await owner(base+'contracts','POST',{location_id:'loc-a',starts_on:'2028-01-01',ends_on:'2028-12-31',amount:36000,request_key:'phase1-contract'});
 assert.equal(c.status,201);
 assert.equal((await owner(base+'contracts/'+c.data.id,'PATCH',{version:1,status:'active',reference:'虛構借址合約確認'})).status,200);
 const b=await finance(base+'invoices','POST',{kind:'address',source_id:c.data.id,due_on:'2028-01-01',request_key:'phase1-bill'});assert.equal(b.status,201);
 const receipt=await finance(base+'invoices/'+b.data.id+'/ledger','POST',{version:1,direction:'receipt',amount:12000,reference:'虛構收款',request_key:'phase1-receipt'});
 assert.equal(receipt.status,201);assert.equal(receipt.data.actor_id,'finance-a');
 assert.equal((await finance(base+'invoices/'+b.data.id+'/ledger','POST',{version:2,direction:'refund',amount:1000,refund_of:receipt.data.id,reference:'虛構退款更正',request_key:'phase1-refund'})).status,201);
 const bill=(await finance(base+'invoices')).data.find(r=>r.id===b.data.id);assert.equal(bill.net_received,11000);assert.equal(bill.balance,25000);
 assert.equal((await owner(base+'contracts/'+c.data.id+'/renew','POST',{version:2,starts_on:'2029-01-01',ends_on:'2029-12-31',amount:38000,request_key:'phase1-renew'})).status,201);
 const events=(await owner('/activity?business_id=b4')).data.filter(e=>e.action==='ledger_recorded');
 assert.equal(events.length,2);assert(events.every(e=>e.actor_name==='財務 · 周月'));
 assert(db.sqlite.prepare("SELECT actor_id FROM activity_events WHERE action='ledger_recorded'").all().every(e=>e.actor_id==='finance-a'));assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM digital_revenue_terms WHERE platform_share_bps IS NOT NULL').get().n,0);
});
