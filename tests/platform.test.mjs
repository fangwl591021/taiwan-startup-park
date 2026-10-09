import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,seed} from '../scripts/database.mjs';
import worker from '../dist/worker.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on'};
 async function as(id){
  const headers={origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'};
  const login=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers,body:JSON.stringify({user_id:id})}),env);assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return async(path,method='GET',data,extra={})=>{
   const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{...headers,cookie,...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
   return {status:r.status,data:await r.json()};
  };
 }
 return {db,as};
}
const planning={version:1,oa_name:'平台 OA 規劃',provider_id:'123',channel_id:'456',purpose:'業者服務',onboarding_template:'加入說明',service_template:'平台服務通知',monthly_limit:null,reference:'規劃核對'};
test('platform console requires explicit platform permission and does not imply chat/customer access',async t=>{
 const {db,as}=await fixture(t),platform=await as('platform');
 for(const id of ['owner-a','owner-b','sales-a1','service-a','finance-a','business-admin']){
  const user=await as(id);assert.equal((await user('/me')).data.platform_access,false);
  for(const path of ['/platform/overview','/platform/operators','/platform/connections','/platform/settings','/platform/revenue','/platform/activity'])assert.equal((await user(path)).status,403,id+path);
  assert.equal((await user('/platform/settings','PATCH',planning)).status,403);
 }
 assert.equal((await platform('/me')).data.platform_access,true);
 const summary=(await platform('/platform/operators')).data;assert.equal(summary.total,2);assert.equal(summary.items.length,2);
 for(const path of ['/businesses','/tenants','/opportunities','/conversations','/line/inbox','/line/settings','/activity'])assert.equal((await platform(path)).status,403);
 db.sqlite.prepare("INSERT INTO platform_admin_grants VALUES('owner-a',1,'test explicit platform grant','2026-10-07T00:00:00Z')").run();
 const dual=await as('owner-a');assert.equal((await dual('/me')).data.role,'operator_owner');assert.equal((await dual('/me')).data.platform_access,true);
 assert.equal((await dual('/platform/overview')).status,200);assert.equal((await dual('/businesses/bb')).status,404);
 db.sqlite.prepare("UPDATE platform_admin_grants SET active=0 WHERE user_id='owner-a'").run();assert.equal((await dual('/platform/overview')).status,403);
});
test('platform OA draft is versioned, audited, cannot save secrets or enable send/settlement',async t=>{
 const {db,as}=await fixture(t),platform=await as('platform');
 const before=db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n;
 assert.equal((await platform('/platform/settings','PATCH',planning)).status,200);
 const state=(await platform('/platform/settings')).data;assert.equal(state.status,'planning');assert.equal(state.connected,false);assert.equal(state.push_enabled,false);assert.equal(state.settings.monthly_limit,null);assert.equal(state.settings.version,2);
 assert.equal((await platform('/platform/settings','PATCH',planning)).status,409);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_activity').get().n,1);
 for(const patch of [{channel_secret:'secret'},{channel_access_token:'token'},{push_enabled:true},{role:'platform_admin'},{platform_share_bps:10000}])assert.equal((await platform('/platform/settings','PATCH',{...planning,version:2,...patch})).status,400);
 assert.equal((await platform('/platform/settings','PATCH',{...planning,version:2,monthly_limit:10.5})).status,400);
 assert.equal((await platform('/platform/settings','PATCH',{...planning,version:2},{origin:'http://evil.invalid'})).status,403);
 assert.equal((await platform('/platform/settings','PATCH',{...planning,version:2,monthly_limit:1000})).status,200);
 const history=(await platform('/platform/activity')).data;assert.equal(history.length,2);assert.equal(history[0].actor_name,'系統總管理員（虛構）');assert(!JSON.stringify(history).includes('加入說明'));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,before);
 const revenue=(await platform('/platform/revenue')).data;assert.equal(revenue.terms.length,8);assert.equal(revenue.settlement_enabled,false);assert(revenue.terms.every(r=>r.platform_share_bps===null&&r.platform_fee_amount===null));
});
test('platform channel metadata is bounded and contains no credentials, identities or message contents',async t=>{
 const {db,as}=await fixture(t),platform=await as('platform');
 db.sqlite.prepare("INSERT INTO line_connections(id,operator_id,provider_id,channel_id,destination,enabled,name) VALUES('la','op-a','123','456','secret-bot-identity',1,'青禾 OA')").run();
 db.sqlite.prepare("INSERT INTO line_connection_secrets VALUES('la','op-a','private-encrypted-envelope','2026-10-07T00:00:00Z')").run();
 const data=(await platform('/platform/connections')).data;assert.equal(data.items[0].encrypted_credentials,1);assert.equal(data.items[0].last_webhook_at,null);
 assert(!/private-encrypted-envelope|secret-bot-identity|您好|0900|channel_id|provider_id|user_id|body/.test(JSON.stringify(data)));
 assert.equal((await platform('/platform/operators?q=晴川')).data.items.length,1);
 assert.equal((await platform('/platform/connections?q=不存在')).data.total,0);
 assert.equal((await platform('/platform/operators?offset=-1')).status,400);
 assert.equal((await platform('/platform/operators?offset=1.2')).status,400);
 for(let i=0;i<51;i++)db.sqlite.prepare('INSERT INTO operators VALUES(?,?)').run('page-'+String(i).padStart(3,'0'),'測試業者'+i);
 const first=(await platform('/platform/operators')).data,second=(await platform('/platform/operators?offset=50')).data;
 assert.equal(first.items.length,50);assert.equal(second.items.length,3);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,53);
});
test('platform migration grants only preapproved primary identity and preserves ordinary ownership',async t=>{
 const {db}=await fixture(t);db.sqlite.exec('DROP TABLE platform_activity; DROP TABLE platform_settings; DROP TABLE platform_admin_grants;');
 db.sqlite.prepare("INSERT INTO operators VALUES('tsp-primary-operator','平台')").run();
 db.sqlite.prepare("INSERT INTO staff_users VALUES('tsp-primary-owner','tsp-primary-operator','總管理員','operator_owner',1)").run();
 db.sqlite.prepare("INSERT INTO auth_identities VALUES('https://test.cloudflareaccess.com','approved-primary','tsp-primary-owner')").run();
 db.sqlite.exec(readFileSync(new URL('../migrations/0009_platform_console.sql',import.meta.url),'utf8'));
 assert.deepEqual(db.sqlite.prepare('SELECT user_id FROM platform_admin_grants').all().map(r=>r.user_id),['tsp-primary-owner']);
 assert.equal(db.sqlite.prepare("SELECT role FROM staff_users WHERE id='tsp-primary-owner'").get().role,'operator_owner');
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_admin_grants WHERE user_id IN('owner-a','owner-b')").get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n,5);
});
