import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {receivePlatformWebhook} from '../dist/platform-webhook.js';
import {database,seed} from '../scripts/database.mjs';
import {encryptLineSecret} from '../dist/line-credentials.js';
const secret='B'.repeat(32),bot='U'+'1'.repeat(32),user='U'+'2'.repeat(32),time=Date.now();
const message=(event_id='ev1',mid='msg1',text='平台自己的來訊')=>({type:'message',webhookEventId:event_id,timestamp:time,source:{type:'user',userId:user},message:{type:'text',id:mid,text}});
async function signature(raw,key=secret){return Buffer.from(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(raw))).toString('base64');}
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',LINE_SEND_ENABLED:'off',LINE_CREDENTIALS_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),HTTP:async()=>{throw Error('No external send permitted');}};
 const encrypted=await encryptLineSecret(env,'__platform_messaging__','messaging:222',{channelSecret:secret,channelAccessToken:'mock-token'});
 db.sqlite.prepare("UPDATE platform_line_account SET messaging_channel_id='222',encrypted_messaging=? WHERE id=1").run(encrypted);
 const key=db.sqlite.prepare('SELECT webhook_key FROM platform_line_account').get().webhook_key;
 const url='http://localhost/api/line/webhook/'+key;
 async function post(events=[],opts={}){const raw=opts.raw??JSON.stringify({destination:opts.destination??bot,events});const r=await worker.fetch(new Request(opts.url??url,{method:'POST',headers:{'x-line-signature':opts.signature??await signature(raw,opts.secret)},body:raw}),env);return{status:r.status,data:await r.json()};}
 async function as(id){const headers={origin:'http://localhost','x-requested-with':'tsp','content-type':'application/json'};
  const r=await worker.fetch(new Request('http://localhost/api/demo/login',{method:'POST',headers,body:JSON.stringify({user_id:id})}),env);const cookie=r.headers.get('set-cookie').split(';')[0];
  return async(path)=>{const r=await worker.fetch(new Request('http://localhost/api'+path,{headers:{...headers,cookie}}),env);return{status:r.status,data:await r.json()};};
 }
 return{db,env,key,url,post,as};
}
test('platform Verify needs raw-body Messaging signature, binds destination and acknowledges empty events',async t=>{
 const{db,env,url,post,as}=await fixture(t),admin=await as('platform');
 assert.equal((await post([],{signature:'invalid'})).status,401);
 assert.equal((await post([],{secret:'A'.repeat(32)})).status,401);
 const raw=JSON.stringify({destination:bot,events:[]});assert.equal((await post([],{raw:raw+' ',signature:await signature(raw)})).status,401);
 assert.equal(db.sqlite.prepare('SELECT last_webhook_at FROM platform_line_account').get().last_webhook_at,'');
 assert.equal((await post()).status,200);assert.equal(db.sqlite.prepare('SELECT destination FROM platform_line_account').get().destination,bot);
 const status=(await admin('/platform/line-account')).data;assert(status.webhook_enabled);assert(status.last_webhook_at);assert(!status.login_enabled&&!status.push_enabled);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_line_events').get().n,0);
 assert.equal((await post([],{destination:'U'+'3'.repeat(32)})).status,400);
 assert.equal((await post([],{raw:'not-json'})).status,400);
 assert.equal((await post([],{url:'http://localhost/api/line/webhook/platform-unknown'})).status,404);
 assert.equal((await worker.fetch(new Request(url),env)).status,405);
 const old=env.LINE_CREDENTIALS_KEY;env.LINE_CREDENTIALS_KEY=Buffer.alloc(32,9).toString('base64');assert.equal((await post()).status,503);env.LINE_CREDENTIALS_KEY=old;
 await assert.rejects(()=>receivePlatformWebhook(new Request(url,{method:'POST'}),{...env,APP_ENV:'sandbox'},'anything'),/不接收真實 LINE/);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
});
test('platform events are durable, idempotent, honor unsends and isolated from every operator inbox',async t=>{
 const{db,post,as}=await fixture(t),admin=await as('platform'),operatorMessages=db.sqlite.prepare('SELECT COUNT(*) n FROM messages').get().n;
 const follow={type:'follow',webhookEventId:'follow1',timestamp:time,source:{type:'user',userId:user}};
 assert.equal((await post([message(),follow])).status,200);assert.equal((await post([message(),follow])).status,200);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_line_events').get().n,2);
 let items=(await admin('/platform/line-events')).data.items;assert.equal(items.length,2);assert.equal(items.find(r=>r.kind==='message').body,'平台自己的來訊');assert(!JSON.stringify(items).includes(user));
 for(const id of['owner-a','owner-b','sales-a1','service-a','finance-a','business-admin'])assert.equal((await (await as(id))('/platform/line-events')).status,403);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_events').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM messages').get().n,operatorMessages);
 const unsend=(id,mid)=>({type:'unsend',webhookEventId:id,timestamp:time+1,unsend:{messageId:mid},source:{type:'user',userId:user}});
 assert.equal((await post([unsend('u1','msg1'),unsend('u2','msg2')])).status,200);
 assert.equal((await post([message(),message('ev2','msg2','不得復原的文字')])).status,200);
 items=(await admin('/platform/line-events')).data.items;assert(items.filter(r=>r.kind==='message').every(r=>r.removed===1&&r.body===null));
 assert.equal((await post([{...message('bad'),timestamp:-1}])).status,400);
 assert(!db.sqlite.prepare("SELECT 1 FROM platform_line_events WHERE event_id='bad'").get());
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,0);
});
test('configuration races and persistence failures never acknowledge or discard a platform event',async t=>{
 const{db,env,post}=await fixture(t);const batch=db.batch.bind(db);let change=true;
 db.batch=async statements=>{if(change){change=false;db.sqlite.prepare('UPDATE platform_line_account SET version=version+1 WHERE id=1').run();}return batch(statements);};
 assert.equal((await post([message()])).status,409);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_line_events').get().n,0);
 db.batch=async()=>{throw Error('intentional persistence failure');};assert.equal((await post([message()])).status,500);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_line_events').get().n,0);
 db.batch=batch;assert.equal((await post([message()])).status,200);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_line_events').get().n,1);
});
