import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {database,seed} from '../scripts/database.mjs';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function as(id){
  const login=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'},body:JSON.stringify({user_id:id})}),env);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return async path=>{const r=await worker.fetch(new Request('http://localhost/api'+path,{headers:{cookie}}),env);return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};};
 }
 return {db,as};
}
test('paged tenant/case/chat lists and exact dashboard statistics retain every actor scope',async t=>{
 const {as}=await fixture(t);
 for(const id of ['owner-a','sales-a1','service-a','finance-a','owner-b']){
  const actor=await as(id),summary=await actor('/dashboard');assert.equal(summary.status,200);assert.equal(summary.cache,'no-store');
  const tenants=await actor('/tenants');assert.equal(summary.data.stats.tenant_count,tenants.data.length);
  for(const endpoint of ['/tenants',...(['service-a'].includes(id)?[]:['/opportunities']),...(['finance-a'].includes(id)?[]:['/conversations'])]){
   const original=await actor(endpoint),seen=[];let cursor=null;
   do{const r=await actor(endpoint+'?paged=1&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);assert.equal(r.data.total,original.data.length);assert(r.data.items.length<=1);seen.push(...r.data.items.map(x=>x.id));cursor=r.data.next_cursor;}while(cursor);
   assert.deepEqual(new Set(seen),new Set(original.data.map(x=>x.id)));
  }
  if(id==='service-a'){assert.deepEqual(summary.data.opportunities,[]);assert.equal((await actor('/opportunities?paged=1')).status,403);}
  else{const cases=(await actor('/opportunities')).data;assert.equal(summary.data.stats.open_count,cases.filter(o=>!['won','lost'].includes(o.stage)).length);assert(summary.data.opportunities.length<=4);}
  if(id==='finance-a')assert.equal((await actor('/conversations?paged=1')).status,403);
 }
});
test('one thousand tenants remain bounded, complete, searchable and served by paging index',async t=>{
 const {db,as}=await fixture(t),actor=await as('owner-a');const base=(await actor('/tenants')).data.length;
 const insert=db.sqlite.prepare("INSERT INTO businesses(id,operator_id,name,is_tenant,service_owner_id,created_at) VALUES(?,'op-a',?,1,'owner-a',?)");
 db.sqlite.exec('BEGIN');for(let i=0;i<1000;i++)insert.run('perf-'+String(i).padStart(4,'0'),'大量資料租戶 '+i,'2026-10-06T01:00:00.000Z');db.sqlite.exec('COMMIT');
 const start=performance.now(),seen=new Set();let cursor=null,pages=0;
 do{const r=await actor('/tenants?paged=1&limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);assert.equal(r.data.total,base+1000);assert(r.data.items.length<=50);for(const row of r.data.items){assert.equal(row.operator_id,'op-a');assert(!seen.has(row.id));seen.add(row.id);}cursor=r.data.next_cursor;pages++;}while(cursor);
 assert.equal(seen.size,base+1000);
 const search=await actor('/tenants?paged=1&q='+encodeURIComponent('大量資料租戶 999'));assert.equal(search.data.total,1);assert.equal(search.data.items[0].id,'perf-0999');
 assert.equal((await actor('/dashboard')).data.stats.tenant_count,base+1000);
 const plan=db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM businesses WHERE operator_id=? AND is_tenant=1 ORDER BY created_at DESC,id DESC LIMIT 51").all('op-a');
 assert(plan.some(r=>r.detail.includes('businesses_tenant_page')));
 console.log('PERFORMANCE_DB_LARGE '+JSON.stringify({tenants:base+1000,pages,elapsed_ms:Math.round(performance.now()-start),max_page_size:50,index:'businesses_tenant_page',environment:'local SQLite; not production latency'}));
});
test('malformed/oversized paging inputs cannot change authority or create unbounded responses',async t=>{
 const {as}=await fixture(t),actor=await as('sales-a1');
 for(const args of ['limit=0','limit=101','limit=1000000','limit=abc','cursor=bad!','cursor='+encodeURIComponent(btoa(JSON.stringify({operator_id:'op-b'}))))])assert.equal((await actor('/tenants?paged=1&'+args)).status,400);
 const r=await actor('/tenants?paged=1&operator_id=op-b');assert.equal(r.status,200);assert(r.data.items.every(x=>x.operator_id==='op-a'));
});
