import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from '../scripts/database.mjs';
import worker from '../dist/worker.js';
import {platformLoginRoute} from '../dist/platform-login.js';
import {decryptStoredSecret} from '../dist/line-credentials.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',LINE_CREDENTIALS_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),HTTP:async()=>{throw new Error('No Login/OA network calls while not enabled');}};
 const headers={origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'};
 async function as(id){const r=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers,body:JSON.stringify({user_id:id})}),env);assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
  return async(path,method='GET',data,extra={})=>{const res=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{...headers,cookie,...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);return{status:res.status,data:await res.json()};};}
 return{db,env,as};
}
const secret='a'.repeat(32),draft={provider_id:'123',channel_id:'456',channel_secret:secret,version:1,reference:'Login Channel 核對'};
test('LINE Login credentials are distinct, encrypted, never returned and cannot start login or elevate a role',async t=>{
 const {db,env,as}=await fixture(t),admin=await as('platform');
 const original=JSON.stringify(db.sqlite.prepare('SELECT * FROM platform_settings').get());
 assert.equal((await admin('/platform/line-login','PATCH',draft)).status,200);
 const row=db.sqlite.prepare('SELECT * FROM platform_line_login').get();assert(!row.encrypted_secret.includes(secret));
 assert.equal((await decryptStoredSecret(env,'__platform_line_login__','login:456',row.encrypted_secret)).channelSecret,secret);
 assert.deepEqual(await decryptStoredSecret(env,'op-a','456',row.encrypted_secret),{});
 const state=(await admin('/platform/line-login')).data;assert.equal(state.secret_configured,true);assert.equal(state.callback_active,false);assert.equal(state.login_enabled,false);assert.deepEqual(state.scopes,['openid','profile']);assert.equal(state.callback_url,'http://localhost/api/auth/line/callback');
 assert(!/encrypted_secret|channel_secret|channelSecret/.test(JSON.stringify(state)));assert(!JSON.stringify(state).includes(secret));
 assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM platform_settings').get()),original);
 assert.equal((await admin('/platform/line-login','PATCH',draft)).status,409);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_activity').get().n,1);
 const {channel_secret,...same}=draft;assert.equal((await admin('/platform/line-login','PATCH',{...same,version:2})).status,200);assert.equal((await admin('/platform/line-login')).data.secret_configured,true);
 assert.equal((await admin('/platform/line-login','PATCH',{...same,channel_id:'789',version:3})).status,200);assert.equal((await admin('/platform/line-login')).data.secret_configured,false);assert.equal(db.sqlite.prepare('SELECT encrypted_secret FROM platform_line_login').get().encrypted_secret,'');
 const sessions=db.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n;
 const callback=await admin('/auth/line/callback?code=forged&state=forged');assert.equal(callback.status,503);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n,sessions);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_admin_grants').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
 assert(!JSON.stringify((await admin('/platform/activity')).data).includes(secret));
});
test('Login settings block ordinary operators, forged OAuth fields, cross-origin writes and sandbox real credentials',async t=>{
 const {db,env,as}=await fixture(t),admin=await as('platform');
 for(const id of ['owner-a','owner-b','sales-a1','service-a','finance-a']){const user=await as(id);assert.equal((await user('/platform/line-login')).status,403);assert.equal((await user('/platform/line-login','PATCH',draft)).status,403);}
 for(const extra of [{channel_access_token:'OA-token'},{webhook_url:'https://invalid'},{callback_url:'https://evil.invalid'},{login_enabled:true},{scope:'email'},{role:'platform_admin'}])assert.equal((await admin('/platform/line-login','PATCH',{...draft,...extra})).status,400);
 assert.equal((await admin('/platform/line-login','PATCH',draft,{origin:'http://evil.invalid'})).status,403);
 const a={id:'platform',operator_id:'op-a',name:'system',role:'platform_admin',active:1};
 await assert.rejects(()=>platformLoginRoute(new Request('http://localhost/api/platform/line-login',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(draft)}),{...env,APP_ENV:'sandbox'},a),/不保存真實/);
 await assert.rejects(()=>platformLoginRoute(new Request('http://localhost/api/platform/line-login',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(draft)}),{...env,LINE_CREDENTIALS_KEY:undefined},a),/不保存真實/);
 assert.equal(db.sqlite.prepare('SELECT version FROM platform_line_login').get().version,1);
});
