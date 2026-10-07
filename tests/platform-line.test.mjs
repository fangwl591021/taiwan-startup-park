import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from '../scripts/database.mjs';
import worker from '../dist/worker.js';
import {platformLineRoute} from '../dist/platform-line.js';
import {decryptStoredSecret} from '../dist/line-credentials.js';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',LINE_CREDENTIALS_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')};
 const headers={origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp'};
 async function as(id){const r=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers,body:JSON.stringify({user_id:id})}),env);const cookie=r.headers.get('set-cookie').split(';')[0];return async(path,method='GET',data,extra={})=>{const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{...headers,cookie,...extra},...(data?{body:JSON.stringify(data)}:{})}),env);return{status:r.status,data:await r.json()};};}
 return{db,env,as};
}
const draft={oa_name:'台灣創業園',basic_id:'@startup',login_channel_id:'111',login_provider_id:'11',messaging_channel_id:'222',messaging_provider_id:'22',version:1,login_version:1,planning_version:1,reference:'核對兩個獨立頻道'};
const loginSecret='A'.repeat(32),msgSecret='B'.repeat(32),token='token-'+ 'C'.repeat(50);
test('unified platform LINE save encrypts independent credentials, preserves blanks and commits atomically',async t=>{
 const{db,env,as}=await fixture(t),admin=await as('platform');
 const body={...draft,login_channel_secret:loginSecret,messaging_channel_secret:msgSecret,messaging_access_token:token};
 assert.equal((await admin('/platform/line-account','PATCH',body)).status,200);
 const row=db.sqlite.prepare('SELECT * FROM platform_line_account').get(),login=db.sqlite.prepare('SELECT * FROM platform_line_login').get();
 assert.equal((await decryptStoredSecret(env,'__platform_line_login__','login:111',login.encrypted_secret)).channelSecret,loginSecret);
 assert.deepEqual(await decryptStoredSecret(env,'__platform_messaging__','messaging:222',row.encrypted_messaging),{channelSecret:msgSecret,channelAccessToken:token});
 assert.deepEqual(await decryptStoredSecret(env,'__platform_line_login__','login:222',row.encrypted_messaging),{});
 let state=(await admin('/platform/line-account')).data;assert(state.has_login_secret&&state.has_messaging_secret&&state.has_messaging_token);
 assert.equal(state.oa_name,draft.oa_name);assert.equal(state.basic_id,'@startup');assert.equal(state.webhook_enabled,true);assert.equal(state.login_enabled,false);assert.equal(state.push_enabled,false);
 for(const value of[loginSecret,msgSecret,token]){assert(!JSON.stringify(state).includes(value));assert(!JSON.stringify((await admin('/platform/activity')).data).includes(value));assert(!JSON.stringify([row,login]).includes(value));}
 assert.equal((await admin('/platform/line-account','PATCH',{...draft,oa_name:'stale'})).status,409);assert.equal(db.sqlite.prepare('SELECT oa_name FROM platform_settings').get().oa_name,draft.oa_name);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_activity').get().n,1);
 const next={...draft,version:2,login_version:2,planning_version:2,login_channel_secret:'',messaging_channel_secret:'',messaging_access_token:''};
 assert.equal((await admin('/platform/line-account','PATCH',next)).status,200);state=(await admin('/platform/line-account')).data;assert(state.has_login_secret&&state.has_messaging_token&&state.has_messaging_secret);
 assert.equal((await admin('/platform/line-account','PATCH',{...next,version:3,login_version:3,planning_version:3,messaging_access_token:'replacement-'+ 'D'.repeat(40)})).status,200);
 assert.equal((await admin('/platform/line-account')).data.has_messaging_secret,true);
 assert.equal((await admin('/platform/line-account','PATCH',{...draft,version:4,login_version:4,planning_version:4,messaging_channel_id:'333'})).status,200);
 state=(await admin('/platform/line-account')).data;assert(state.has_login_secret);assert(!state.has_messaging_secret&&!state.has_messaging_token);assert.equal(state.webhook_url,row.webhook_key?'http://localhost/api/line/webhook/'+row.webhook_key:'');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_connections').get().n,0);
 assert.equal((await admin('/line/webhook/'+row.webhook_key,'POST',{destination:'forged',events:[]})).status,503);
});
test('platform settings reject other roles, CSRF, activation fields and real sandbox secrets; preserve prior Login',async t=>{
 const{db,env,as}=await fixture(t),admin=await as('platform');
 for(const id of['owner-a','owner-b','sales-a1','service-a','finance-a','business-admin']){const user=await as(id);assert.equal((await user('/platform/line-account')).status,403);assert.equal((await user('/platform/line-account','PATCH',draft)).status,403);}
 for(const extra of[{webhook_enabled:true},{push_enabled:true},{operator_id:'op-b'},{role:'platform_admin'},{callback_url:'https://evil.invalid'}])assert.equal((await admin('/platform/line-account','PATCH',{...draft,...extra})).status,400);
 assert.equal((await admin('/platform/line-account','PATCH',draft,{origin:'http://evil.invalid'})).status,403);
 const actor={id:'platform',operator_id:'op-a',role:'platform_admin',name:'system',active:1};
 await assert.rejects(()=>platformLineRoute(new Request('http://localhost/api/platform/line-account',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({...draft,login_channel_secret:loginSecret})}),{...env,APP_ENV:'sandbox'},actor),/不保存真實憑證/);
 assert.equal((await admin('/platform/line-login','PATCH',{channel_id:'111',provider_id:'11',channel_secret:loginSecret,version:1,reference:'先前 Login 設定'})).status,200);
 assert.equal((await admin('/platform/line-account')).data.has_login_secret,true);
 assert.equal((await admin('/platform/line-account','PATCH',draft)).status,409);assert.equal(db.sqlite.prepare('SELECT version FROM platform_line_account').get().version,1);
 assert.equal((await admin('/platform/line-account','PATCH',{...draft,login_version:2})).status,200);assert.equal((await admin('/platform/line-account')).data.has_login_secret,true);
});
