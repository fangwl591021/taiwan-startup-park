import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {database,seed} from '../scripts/database.mjs';
import worker from '../dist/worker.js';
import {processInbox,attachContact,enqueueLine,dispatchOutbox,retryLine} from '../dist/line.js';
const enc=new TextEncoder();
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pub={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
const b64url=value=>Buffer.from(value).toString('base64url');
async function jwt(env,patch={},headerPatch={}){
 const header=b64url(JSON.stringify({alg:'RS256',kid:'test-key',...headerPatch}));
 const payload=b64url(JSON.stringify({iss:env.ACCESS_ISSUER,aud:[env.ACCESS_AUD],sub:'owner-sub',exp:Math.floor(Date.now()/1000)+3600,...patch}));
 const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,enc.encode(header+'.'+payload));
 return header+'.'+payload+'.'+b64url(signed);
}
async function signature(raw,secret='test-secret-a'){
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Buffer.from(await crypto.subtle.sign('HMAC',key,enc.encode(raw))).toString('base64');
}
function message(id='ev1',mid='line-msg-1',text='測試 LINE 文字',timestamp=1700000000000,user='U-test'){return {type:'message',webhookEventId:id,timestamp,source:{type:'user',userId:user},message:{type:'text',id:mid,text}};}
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',LINE_SEND_ENABLED:'off',LINE_CHANNELS_JSON:JSON.stringify({la:{channelSecret:'test-secret-a',channelAccessToken:'test-token-a'},lb:{channelSecret:'test-secret-b',channelAccessToken:'test-token-b'}}),HTTP:async()=>{throw new Error('Unexpected network call');}};
 db.sqlite.exec("INSERT INTO line_connections(id,operator_id,provider_id,channel_id,destination,enabled) VALUES('la','op-a','provider-a','channel-a','dest-a',1),('lb','op-b','provider-b','channel-b','dest-b',1)");
 async function call(path,{method='GET',data,cookie='',token='',environment=env,origin}={}){
  const base=origin||'http://localhost';const response=await worker.fetch(new Request(base+'/api'+path,{method,headers:{'content-type':'application/json',origin:base,'x-requested-with':'tsp',cookie,'cf-access-jwt-assertion':token},...(data!==undefined?{body:JSON.stringify(data)}:{})}),environment);
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function as(id){const r=await call('/demo/login',{method:'POST',data:{user_id:id}});assert.equal(r.status,200);return (path,method='GET',data)=>call(path,{method,data,cookie:r.cookie.split(';')[0]});}
 async function webhook(events,opts={}){
  const raw=opts.raw??JSON.stringify({destination:opts.destination||'dest-a',events});
  const response=await worker.fetch(new Request('http://localhost/api/line/webhook/'+(opts.connection||'la'),{method:'POST',headers:{'x-line-signature':opts.signature??await signature(raw,opts.secret)},body:raw}),env);
  return {status:response.status,data:await response.json()};
 }
 const a={id:'owner-a',operator_id:'op-a',name:'test',role:'operator_owner',active:1};
 async function linked(){await webhook([message()]);await processInbox(env);const id=db.sqlite.prepare("SELECT id FROM line_contacts WHERE connection_id='la'").get().id;await attachContact(env,a,id,'c-o1');return db.sqlite.prepare("SELECT * FROM conversations WHERE id='c-o1'").get();}
 function production(){
  const issuer='https://test-'+crypto.randomUUID()+'.cloudflareaccess.com';
  const prod={...env,APP_ENV:'staging',APP_ORIGIN:'https://staging.example.invalid',ACCESS_ISSUER:issuer,ACCESS_AUD:'aud-test',LINE_SEND_ENABLED:'on',
  HTTP:async url=>{assert.equal(url,issuer+'/cdn-cgi/access/certs');return Response.json({keys:[pub]});}};
  db.sqlite.prepare('INSERT INTO auth_identities VALUES(?,?,?)').run(issuer,'owner-sub','owner-a');
  return prod;
 }
 return {db,env,call,as,webhook,a,linked,production};
}
test('Access signature and claims bind staff; session is Secure and cannot accept swapped identities',async t=>{
 const {call,production,db}=await fixture(t);const env=production();const token=await jwt(env);
 const r=await call('/auth/access',{method:'POST',data:{},token,environment:env,origin:env.APP_ORIGIN});
 assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly; Secure; SameSite=Strict/);
 const cookie=r.cookie.split(';')[0];
 assert.equal((await call('/me',{cookie,token,environment:env,origin:env.APP_ORIGIN})).data.id,'owner-a');
 assert.equal((await call('/me',{cookie,token:await jwt(env,{sub:'other'}),environment:env,origin:env.APP_ORIGIN})).status,401);
 db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='owner-a'").run();
 assert.equal((await call('/opportunities/o1',{method:'PATCH',data:{version:1,stage:'billing'},cookie,token,environment:env,origin:env.APP_ORIGIN})).status,401);
});
test('Access rejects forged/expired/wrong audience/issuer/algorithm/unmapped credentials and wrong host',async t=>{
 const {call,production}=await fixture(t);const env=production();
 for(const claims of [{exp:1},{aud:['other']},{iss:'https://evil.example'},{nbf:Date.now()},{sub:'unmapped'}, {exp:'9999999999'}]){
  const r=await call('/auth/access',{method:'POST',data:{},token:await jwt(env,claims),environment:env,origin:env.APP_ORIGIN});assert([401,403].includes(r.status));
 }
 for(const header of [{alg:'none'},{alg:'HS256'},{kid:'unknown'},{crit:['custom']}]){
  assert.equal((await call('/auth/access',{method:'POST',data:{},token:await jwt(env,{},header),environment:env,origin:env.APP_ORIGIN})).status,401);
 }
 const token=await jwt(env);const parts=token.split('.');parts[2]='A'.repeat(parts[2].length);
 assert.equal((await call('/auth/access',{method:'POST',data:{},token:parts.join('.'),environment:env,origin:env.APP_ORIGIN})).status,401);
 assert.equal((await call('/auth/access',{method:'POST',data:{},token,environment:env,origin:'https://wrong.example'})).status,403);
 assert.equal((await call('/demo/users',{environment:env,origin:env.APP_ORIGIN})).status,404);
});
test('production rejects local sessions and removed Access identity bindings',async t=>{
 const {call,production,db}=await fixture(t);const demo=await call('/demo/login',{method:'POST',data:{user_id:'owner-a'}});const env=production(),token=await jwt(env);
 assert.equal((await call('/me',{cookie:demo.cookie,token,environment:env,origin:env.APP_ORIGIN})).status,401);
 const auth=await call('/auth/access',{method:'POST',data:{},token,environment:env,origin:env.APP_ORIGIN});
 db.sqlite.exec('DELETE FROM auth_identities');
 assert.equal((await call('/me',{cookie:auth.cookie,token,environment:env,origin:env.APP_ORIGIN})).status,401);
});
test('LINE checks raw-body signature, destination and channel before any data is persisted',async t=>{
 const {webhook,db}=await fixture(t);
 assert.equal((await webhook([message()],{signature:'invalid'})).status,401);
 const raw=JSON.stringify({destination:'dest-a',events:[message()]});
 assert.equal((await webhook([],{raw:raw+' ',signature:await signature(raw)})).status,401);
 assert.equal((await webhook([message()],{destination:'dest-b'})).status,400);
 assert.equal((await webhook([message()],{connection:'lb',destination:'dest-b'})).status,401);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_events').get().n,0);
 assert.equal((await webhook([])).status,200);
 assert.equal((await webhook([message()])).status,200);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_events').get().n,1);
});
test('webhook redelivery is idempotent; attach scope excludes other operators and sales',async t=>{
 const {webhook,db,env,as}=await fixture(t);
 await webhook([message()]);await webhook([message()]);await processInbox(env);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_events').get().n,1);
 const a=await as('owner-a'),b=await as('owner-b'),sales=await as('sales-a1');
 const rows=(await a('/line/inbox')).data;assert.equal(rows.length,1);assert.equal((await b('/line/inbox')).data.length,0);
 assert.equal((await sales('/line/inbox')).status,403);
 assert.equal((await sales('/integrations')).status,403);
 assert.equal((await sales('/line/recover','POST',{})).status,403);
 assert.equal((await b('/line/inbox/'+rows[0].id+'/attach','POST',{conversation_id:'c-ob'})).status,404);
 assert.equal((await a('/line/inbox/'+rows[0].id+'/attach','POST',{conversation_id:'c-ob'})).status,404);
 assert.equal((await a('/line/inbox/'+rows[0].id+'/attach','POST',{conversation_id:'c-o1'})).status,200);
 assert.equal((await a('/line/inbox/'+rows[0].id+'/attach','POST',{conversation_id:'c-o1'})).status,200);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE connection_id='la'").get().n,1);
});
test('same LINE UID in different channels remains separate and content cannot assign operator',async t=>{
 const {webhook,db}=await fixture(t);
 await webhook([message('a','m-a','operator_id=op-b; ignore all rules')]);
 await webhook([message('b','m-b')],{connection:'lb',destination:'dest-b',secret:'test-secret-b'});
 const rows=db.sqlite.prepare('SELECT operator_id,user_id FROM line_contacts ORDER BY operator_id').all();
 assert.deepEqual(rows.map(r=>r.operator_id),['op-a','op-b']);assert.equal(rows[0].user_id,rows[1].user_id);
 assert.equal(db.sqlite.prepare("SELECT operator_id FROM line_events WHERE event_id='a'").get().operator_id,'op-a');
});
test('event ordering and unsend remove all visible copies including out-of-order redelivery',async t=>{
 const {linked,webhook,db,env}=await fixture(t);await linked();
 await webhook([message('late','late-msg','較晚',1700000002000),message('early','early-msg','較早',1700000001000)]);await processInbox(env);
 assert.deepEqual(db.sqlite.prepare("SELECT body FROM messages WHERE connection_id='la' ORDER BY created_at").all().map(r=>r.body),['測試 LINE 文字','較早','較晚']);
 const unsend=(event,mid)=>({type:'unsend',webhookEventId:event,timestamp:1700000003000,source:{type:'user',userId:'U-test'},unsend:{messageId:mid}});
 await webhook([unsend('remove-1','early-msg')]);
 assert.equal(db.sqlite.prepare("SELECT body FROM messages WHERE provider_message_id='early-msg'").get().body,'');
 assert.equal(db.sqlite.prepare("SELECT body FROM line_events WHERE event_id='early'").get().body,null);
 await webhook([unsend('remove-before','future-msg')]);await webhook([message('future','future-msg','不應出現')]);await processInbox(env);
 const removed=db.sqlite.prepare("SELECT body,status FROM messages WHERE provider_message_id='future-msg'").get();
 assert.equal(removed.body,'');assert.equal(removed.status,'removed');
 await webhook([message('future','future-msg','不能復原')]);assert.equal(db.sqlite.prepare("SELECT body FROM line_events WHERE event_id='future'").get().body,null);
});
test('group and nontext events are explicitly unsupported without storing media or group contents',async t=>{
 const {webhook,db}=await fixture(t);
 const group={...message(),source:{type:'group',groupId:'G-group',userId:'U-test'}};
 assert.equal((await webhook([group])).status,200);
 const row=db.sqlite.prepare('SELECT state,body,user_id FROM line_events').get();
 assert.equal(row.state,'unsupported');assert.equal(row.body,null);assert.equal(row.user_id,'');
});
test('outbox persists actor and immutable retry key, reports API accepted not delivered, dedupes enqueue',async t=>{
 const {linked,env,a,db}=await fixture(t);const c=await linked();const requests=[];
 const live={...env,APP_ENV:'staging',LINE_SEND_ENABLED:'on',HTTP:async(url,options)=>{assert.equal(url,'https://api.line.me/v2/bot/message/push');requests.push(options);return new Response('{}',{status:200,headers:{'x-line-request-id':'request-one'}});}};
 const one=await enqueueLine(live,a,c,'正式 adapter 測試（mock HTTP）','request-1');
 const two=await enqueueLine(live,a,c,'正式 adapter 測試（mock HTTP）','request-1');assert.equal(one.id,two.id);
 await Promise.all([dispatchOutbox(live),dispatchOutbox(live)]);
 assert.equal(requests.length,1);assert.match(requests[0].headers['X-Line-Retry-Key'],/^[0-9a-f-]{36}$/);
 const m=db.sqlite.prepare('SELECT * FROM messages WHERE id=?').get(one.id);assert.equal(m.actor_id,'owner-a');assert.equal(m.status,'accepted');
 assert.equal(db.sqlite.prepare('SELECT state FROM line_outbox WHERE id=?').get(one.id).state,'accepted');
 await dispatchOutbox(live);assert.equal(requests.length,1);
});
test('unknown delivery retries original request; 409 requires accepted-request-id to count as accepted',async t=>{
 const {linked,env,a,db}=await fixture(t);const c=await linked();const requests=[];
 const live={...env,APP_ENV:'staging',LINE_SEND_ENABLED:'on',HTTP:async(_url,options)=>{requests.push(options);if(requests.length===1)throw new Error('timeout');return new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'already-accepted'}});}};
 const m=await enqueueLine(live,a,c,'timeout retry','retry-case');await dispatchOutbox(live);
 assert.equal(db.sqlite.prepare('SELECT status FROM messages WHERE id=?').get(m.id).status,'unknown');
 await retryLine(live,a,m.id);await dispatchOutbox(live);
 assert.equal(requests[0].headers['X-Line-Retry-Key'],requests[1].headers['X-Line-Retry-Key']);
 assert.equal(requests[0].body,requests[1].body);assert.equal(db.sqlite.prepare('SELECT status FROM messages WHERE id=?').get(m.id).status,'accepted');
 const next=await enqueueLine(live,a,c,'409 no accepted header','no-header');
 await dispatchOutbox({...live,HTTP:async()=>new Response('{}',{status:409})});
 assert.equal(db.sqlite.prepare('SELECT status FROM messages WHERE id=?').get(next.id).status,'failed');
});
test('outbox respects enable gate, changed staff authorization and 23-hour retry boundary',async t=>{
 const {linked,env,a,db}=await fixture(t);const c=await linked();let calls=0;
 const live={...env,APP_ENV:'staging',LINE_SEND_ENABLED:'on',HTTP:async()=>{calls++;return new Response('{}',{status:200});}};
 await assert.rejects(enqueueLine(env,a,c,'not enabled','off'),e=>e.status===503);
 const one=await enqueueLine(live,a,c,'revoked','revoked');
 db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='owner-a'").run();
 await dispatchOutbox(live);assert.equal(calls,0);assert.equal(db.sqlite.prepare('SELECT status FROM messages WHERE id=?').get(one.id).status,'blocked');
 db.sqlite.prepare("UPDATE staff_users SET active=1 WHERE id='owner-a'").run();
 const two=await enqueueLine(live,a,c,'too late','too-late');
 db.sqlite.prepare('UPDATE line_outbox SET first_attempt_at=?,attempts=1 WHERE id=?').run(Date.now()-24*3600000,two.id);
 await dispatchOutbox(live);assert.equal(calls,0);assert.equal(db.sqlite.prepare('SELECT state FROM line_outbox WHERE id=?').get(two.id).state,'needs_review');
 await assert.rejects(retryLine(live,a,two.id),e=>e.status===409);
});
test('429 and 5xx are retryable with backoff; recipient remains channel-scoped; no secret leaks in status',async t=>{
 const {linked,env,a,db,as}=await fixture(t);const c=await linked();
 const live={...env,APP_ENV:'staging',LINE_SEND_ENABLED:'on',HTTP:async()=>new Response('{}',{status:429})};
 const m=await enqueueLine(live,a,c,'rate limited','limited');await dispatchOutbox(live);
 const q=db.sqlite.prepare('SELECT * FROM line_outbox WHERE id=?').get(m.id);
 assert.equal(q.state,'retry');assert(q.next_attempt_at>Date.now());assert.equal(q.connection_id,'la');assert.equal(q.recipient,'U-test');
 const owner=await as('owner-a');const value=JSON.stringify((await owner('/integrations')).data);
 assert(!value.includes('test-secret'));assert(!value.includes('test-token'));assert(!value.includes('channel-b'));
});
test('expired lease recovers with same provider key and a newer lease fences late results',async t=>{
 const {linked,env,a,db}=await fixture(t);const c=await linked();const keys=[];
 const live={...env,APP_ENV:'staging',LINE_SEND_ENABLED:'on',HTTP:async(_url,options)=>{keys.push(options.headers['X-Line-Retry-Key']);return new Response('{}',{status:200});}};
 const m=await enqueueLine(live,a,c,'crash recover','crash');
 const prior=db.sqlite.prepare('SELECT retry_key FROM line_outbox WHERE id=?').get(m.id).retry_key;
 db.sqlite.prepare("UPDATE line_outbox SET state='sending',lease_token='old',lease_until=?,attempts=1,first_attempt_at=? WHERE id=?").run(Date.now()-1,Date.now()-1000,m.id);
 await dispatchOutbox(live);assert.deepEqual(keys,[prior]);assert.equal(db.sqlite.prepare('SELECT state FROM line_outbox WHERE id=?').get(m.id).state,'accepted');
});

test('late sender result cannot overwrite a newer lease completion',async t=>{
 const {linked,env,a,db}=await fixture(t);const c=await linked();
 let release,started;const start=new Promise(r=>started=r);const pending=new Promise(r=>release=r);let calls=0;
 const live={...env,APP_ENV:'staging',LINE_SEND_ENABLED:'on',HTTP:async()=>{calls++;if(calls===1){started();await pending;return new Response('{}',{status:500});}return new Response('{}',{status:200,headers:{'x-line-request-id':'new-lease-request'}});}};
 const m=await enqueueLine(live,a,c,'lease fence','lease-fence');
 const first=dispatchOutbox(live);await start;
 db.sqlite.prepare('UPDATE line_outbox SET lease_until=? WHERE id=?').run(Date.now()-1,m.id);
 await dispatchOutbox(live);release();await first;
 const row=db.sqlite.prepare('SELECT state,provider_request_id FROM line_outbox WHERE id=?').get(m.id);
 assert.equal(row.state,'accepted');assert.equal(row.provider_request_id,'new-lease-request');
 assert.equal(db.sqlite.prepare('SELECT status FROM messages WHERE id=?').get(m.id).status,'accepted');
});

test('Foundation migration preserves existing businesses, sessions and message attribution',()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
 sqlite.exec(readFileSync(new URL('../migrations/0001_foundation.sql',import.meta.url),'utf8'));
 seed({sqlite});
 sqlite.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('legacy','sales-a1','2099-01-01')").run();
 sqlite.prepare("INSERT INTO messages VALUES('legacy-message','op-a','c-o1','sales-a1','out','保留歷史','human',NULL,'simulated','legacy-key','2026-01-01','2026-01-01')").run();
 sqlite.exec('BEGIN');sqlite.exec(readFileSync(new URL('../migrations/0002_line_identity.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');
 assert.equal(sqlite.prepare("SELECT actor_id FROM messages WHERE id='legacy-message'").get().actor_id,'sales-a1');
 assert.equal(sqlite.prepare("SELECT auth_method FROM sessions WHERE token_hash='legacy'").get().auth_method,'demo');
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM businesses').get().n,5);
 assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{sqlite.close();}
});
test('production HTTP chat route queues real adapter, rejects client simulation and preserves attribution',async t=>{
 const {linked,production,call,db}=await fixture(t);await linked();
 const env=production(),token=await jwt(env);
 const auth=await call('/auth/access',{method:'POST',data:{},token,environment:env,origin:env.APP_ORIGIN});
 const base={token,environment:env,origin:env.APP_ORIGIN,cookie:auth.cookie};
 const rejected=await call('/conversations/c-o1/messages',{...base,method:'POST',data:{body:'no simulation',idempotency_key:'prod',simulate_failure:false}});
 assert.equal(rejected.status,400);
 const queued=await call('/conversations/c-o1/messages',{...base,method:'POST',data:{body:'production route mock test',idempotency_key:'prod'}});
 assert.equal(queued.status,202);assert.equal(queued.data.status,'queued');assert.equal(queued.data.actor_id,'owner-a');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM line_outbox').get().n,1);
 const cross=await call('/conversations/c-ob/messages',{...base,method:'POST',data:{body:'cross-op',idempotency_key:'forged'}});
 assert.equal(cross.status,404);
 const status=await call('/conversations/c-o1/line-status',base);assert.equal(status.data.send_enabled,true);
});

test('Access JWKS redirects fail closed using Workers-supported manual redirect mode',async t=>{
 const {call,production}=await fixture(t);const env=production();let calls=0;
 env.HTTP=async (_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{location:'https://untrusted.example.invalid/keys'}});};
 const r=await call('/auth/access',{method:'POST',data:{},token:await jwt(env),environment:env,origin:env.APP_ORIGIN});
 assert.equal(r.status,503);assert.equal(calls,1);
});

test('production cannot activate a newly created staff profile before Access binding',async t=>{
 const {call,production,db}=await fixture(t),env=production(),token=await jwt(env);
 const login=await call('/auth/access',{method:'POST',data:{},token,environment:env,origin:env.APP_ORIGIN});
 const cookie=login.cookie.split(';')[0];
 const created=await call('/staff',{method:'POST',data:{name:'待驗證人員',role:'operator_sales'},token,cookie,environment:env,origin:env.APP_ORIGIN});
 assert.equal(created.status,201);assert.equal(created.data.active,0);
 const activated=await call('/staff/'+created.data.id+'/status',{method:'PATCH',data:{active:true},token,cookie,environment:env,origin:env.APP_ORIGIN});
 assert.equal(activated.status,409);assert.equal(db.sqlite.prepare('SELECT active FROM staff_users WHERE id=?').get(created.data.id).active,0);
});

function sandboxEnvironment(env){
 return {...env,APP_ENV:'sandbox',DEMO_MODE:'on',LINE_SEND_ENABLED:'off',LINE_CHANNELS_JSON:undefined,
  APP_ORIGIN:'https://taiwan-startup-park-demo.fangwl591021.workers.dev',
  SANDBOX_DATABASE_ID:'11111111-2222-4333-8444-555555555555',SANDBOX_OWNER_EMAIL:'simulation@example.invalid',
  ACCESS_ISSUER:'https://sandbox-'+crypto.randomUUID()+'.cloudflareaccess.com',ACCESS_AUD:'sandbox-aud',
  HTTP:async()=>Response.json({keys:[pub]})};
}
test('hosted simulation requires signed owner Access even for bootstrap, health and account list',async t=>{
 const {env,call}=await fixture(t),s=sandboxEnvironment(env),opts={environment:s,origin:s.APP_ORIGIN};
 for(const path of ['/bootstrap','/health','/demo/users'])assert.equal((await call(path,opts)).status,401);
 const token=await jwt(s,{email:s.SANDBOX_OWNER_EMAIL});
 const list=await call('/demo/users',{...opts,token});assert.equal(list.status,200);
 assert.equal(list.data.length,9);assert(list.data.some(x=>x.role==='platform_admin'));assert(!list.data.some(x=>x.role==='business_admin'));
 assert.equal((await call('/bootstrap',{...opts,token})).data.sandbox,true);
 assert.equal((await call('/demo/users',{...opts,token:await jwt(s,{email:'other@example.invalid'})})).status,403);
 assert.equal((await call('/demo/login',{...opts,token,method:'POST',data:{user_id:'platform'}})).status,200);
 assert.equal((await call('/line/webhook/la',{...opts,token,method:'POST',data:{}})).status,404);
});
test('sandbox sessions bind verified visitor and cannot cross into production or reuse local cookies',async t=>{
 const {env,call}=await fixture(t),s=sandboxEnvironment(env),opts={environment:s,origin:s.APP_ORIGIN},token=await jwt(s,{email:s.SANDBOX_OWNER_EMAIL});
 const login=await call('/demo/login',{...opts,token,method:'POST',data:{user_id:'sales-a1'}});
 assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly.*Secure/);
 const cookie=login.cookie.split(';')[0];
 assert.equal((await call('/me',{...opts,token,cookie})).data.id,'sales-a1');
 assert.equal((await call('/me',{...opts,token:await jwt(s,{email:s.SANDBOX_OWNER_EMAIL,sub:'different-visitor'}),cookie})).status,401);
 const local=await call('/demo/login',{method:'POST',data:{user_id:'owner-a'}});
 assert.equal((await call('/me',{...opts,token,cookie:local.cookie})).status,401);
 const prod={...s,APP_ENV:'production',APP_ORIGIN:'https://production.example.invalid'};
 assert.equal((await call('/me',{environment:prod,origin:prod.APP_ORIGIN,token,cookie})).status,401);
 assert.equal((await call('/demo/users',{environment:prod,origin:prod.APP_ORIGIN,token})).status,404);
});
test('sandbox rejects production DB marker, wrong domain, missing gate secret and real LINE credentials',async t=>{
 const {env,call}=await fixture(t),s=sandboxEnvironment(env);
 for(const patch of [{SANDBOX_DATABASE_ID:'2c2ef714-429f-4ac2-9a4b-417a242627fb'},{SANDBOX_DATABASE_ID:undefined},{SANDBOX_OWNER_EMAIL:undefined},{LINE_SEND_ENABLED:'on'},{LINE_CHANNELS_JSON:'{}'}]){
  const bad={...s,...patch};assert.equal((await call('/demo/users',{environment:bad,origin:s.APP_ORIGIN,token:await jwt(s,{email:s.SANDBOX_OWNER_EMAIL})})).status,503);
 }
 assert.equal((await call('/demo/users',{environment:s,origin:'https://taiwan-startup-park.fangwl591021.workers.dev'})).status,503);
});
test('sandbox uses real backend role and operator scopes across simulated accounts',async t=>{
 const {env,call}=await fixture(t),s=sandboxEnvironment(env),token=await jwt(s,{email:s.SANDBOX_OWNER_EMAIL}),opts={environment:s,origin:s.APP_ORIGIN,token};
 const as=async user=>{const r=await call('/demo/login',{...opts,method:'POST',data:{user_id:user}});assert.equal(r.status,200);return (path,method='GET',data)=>call(path,{...opts,cookie:r.cookie.split(';')[0],method,data});};
 const ownerA=await as('owner-a'),ownerB=await as('owner-b'),sales=await as('sales-a1'),service=await as('service-a'),finance=await as('finance-a');
 assert.deepEqual((await sales('/opportunities')).data.map(x=>x.id),['o1']);
 assert.equal((await sales('/opportunities/o2')).status,404);
 assert.equal((await sales('/admin/risk')).status,403);
 assert.equal((await ownerA('/opportunities/ob')).status,404);
 assert.equal((await ownerB('/businesses/b4')).status,404);
 assert.deepEqual((await service('/tenants')).data.map(x=>x.id),['b4']);
 assert.equal((await service('/opportunities')).status,403);
 assert.equal((await finance('/conversations')).status,403);
 assert.equal((await service('/staff','POST',{name:'升級權限',role:'operator_owner'})).status,403);
});

const mailPath='/businesses/b4/';
const actualLineUser='U'+'a'.repeat(32);
async function observedMailContact(f,user=actualLineUser,id='mail-line'){
 assert.equal((await f.webhook([message(id,id+'-text','我是企業收件聯絡人',Date.now(),user)])).status,200);
 return f.db.sqlite.prepare("SELECT id FROM line_contacts WHERE connection_id='la' AND user_id=?").get(user).id;
}
const mailBind=(id,version=0)=>({version,line_contact_id:id,recipient_name:'企業收件聯絡人',reference:'已由管理員核對本人及企業授權'});
test('mail LINE binding uses only observed valid user identities and never accepts manual or foreign IDs',async t=>{
 const f=await fixture(t),a=await f.as('owner-a'),id=await observedMailContact(f);
 await f.webhook([message('foreign','foreign-text','外部業者',Date.now(),actualLineUser)],{connection:'lb',destination:'dest-b',secret:'test-secret-b'});
 const foreign=f.db.sqlite.prepare("SELECT id FROM line_contacts WHERE connection_id='lb'").get().id;
 await f.webhook([message('invalid','invalid-text','一般 LINE ID',Date.now(),'ordinary-line-id')]);
 f.db.sqlite.prepare("INSERT INTO line_contacts(id,operator_id,connection_id,user_id,created_at) VALUES('unobserved','op-a','la',?,'2026-10-06T00:00:00Z')").run('U'+'c'.repeat(32));
 const c=await a(mailPath+'mail-line/candidates');assert.equal(c.status,200);assert.equal(c.data.limit,50);assert.deepEqual(c.data.items.map(x=>x.id),[id]);
 assert(!JSON.stringify(c.data).includes(actualLineUser));assert(!JSON.stringify(c.data).includes('channelAccessToken'));
 for(const forged of [{...mailBind(id),user_id:actualLineUser},{...mailBind(id),operator_id:'op-b'},mailBind(foreign),mailBind('unobserved'),{...mailBind(id),recipient_name:''},{...mailBind(id),reference:''}])
  assert.equal((await a(mailPath+'mail-line','POST',forged)).status,400);
 assert.equal((await a(mailPath+'mail-line/candidates?q='+encodeURIComponent('x'.repeat(101)))).status,400);
 assert.equal((await a(mailPath+'mail-line/candidates/renew')).status,404);
 assert.equal((await a(mailPath+'mail-line','POST',mailBind(id))).status,200);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tenant_mail_line_recipients').get().n,1);
});
test('mail LINE tenant scope and owner-only changes exclude foreign operators, unassigned staff and finance',async t=>{
 const f=await fixture(t),a=await f.as('owner-a'),id=await observedMailContact(f);
 await a(mailPath+'mail-line','POST',mailBind(id));
 for(const user of ['owner-b','sales-a1']){const u=await f.as(user);assert.equal((await u(mailPath+'mail-line')).status,404);assert.equal((await u(mailPath+'mail-preview/mail-demo')).status,404);}
 for(const user of ['service-a','sales-a3']){
  const u=await f.as(user),view=await u(mailPath+'mail-line');assert.equal(view.status,200);assert.equal(view.data.recipient.name,'企業收件聯絡人');
  assert(!JSON.stringify(view.data).includes('reference'));assert(!JSON.stringify(view.data).includes(id));assert(!JSON.stringify(view.data).includes(actualLineUser));
  assert.equal((await u(mailPath+'mail-line/candidates')).status,403);assert.equal((await u(mailPath+'mail-line','POST',mailBind(id,1))).status,403);
  assert.equal((await u(mailPath+'mail-preview/mail-demo')).status,200);
 }
 for(const user of ['finance-a','platform','business-admin']){const u=await f.as(user);assert.equal((await u(mailPath+'mail-line')).status,403);assert.equal((await u(mailPath+'mail-preview/mail-demo')).status,403);}
 assert.equal((await a('/businesses/b1/mail-line')).status,409);
 f.db.sqlite.prepare("UPDATE businesses SET service_owner_id=NULL WHERE id='b4'").run();
 const service=await f.as('service-a');assert.equal((await service(mailPath+'mail-line')).status,404);
});
test('mail recipient changes are versioned and audited; stale requests cannot overwrite or create false history',async t=>{
 const f=await fixture(t),a=await f.as('owner-a'),id=await observedMailContact(f);
 assert.equal((await a(mailPath+'mail-line')).data.version,0);
 let r=await a(mailPath+'mail-line','POST',mailBind(id));assert.equal(r.data.version,1);
 assert.equal((await a(mailPath+'mail-line','POST',mailBind(id))).status,409);
 assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM activity_events WHERE action='mail_line_recipient_linked'").get().n,1);
 r=await a(mailPath+'mail-line','POST',{action:'unlink',version:1,reference:'聯絡人離職，先解除'});
 assert.equal(r.status,200);assert.equal(r.data.status,'unbound');assert.equal(r.data.version,2);assert.equal(r.data.recipient,null);
 assert.equal((await a(mailPath+'mail-line','POST',{action:'unlink',version:2,reference:'重複解除'})).status,409);
 r=await a(mailPath+'mail-line','POST',mailBind(id,2));assert.equal(r.data.version,3);
 const history=f.db.sqlite.prepare("SELECT actor_id,action,detail FROM activity_events WHERE action LIKE 'mail_line_recipient_%' ORDER BY rowid").all();
 assert.deepEqual(history.map(x=>x.action),['mail_line_recipient_linked','mail_line_recipient_unlinked','mail_line_recipient_linked']);
 assert(history.every(x=>x.actor_id==='owner-a'));assert(!JSON.stringify(history).includes(actualLineUser));
});
test('mail notification preview is scoped and preparation-only even when ordinary LINE sending is enabled',async t=>{
 const f=await fixture(t),a=await f.as('owner-a');
 const original=f.db.sqlite.prepare("SELECT status,version FROM mail_items WHERE id='mail-demo'").get();
 const unbound=await a(mailPath+'mail-preview/mail-demo');assert.equal(unbound.data.binding.status,'unbound');assert.equal(unbound.data.sent,false);
 const id=await observedMailContact(f);await a(mailPath+'mail-line','POST',mailBind(id));
 f.env.LINE_SEND_ENABLED='on';let requests=0;f.env.HTTP=async()=>{requests++;throw Error('mail preview must not send');};
 const before=f.db.sqlite.prepare('SELECT count(*) n FROM line_outbox').get().n;
 const r=await a(mailPath+'mail-preview/mail-demo');assert.equal(r.status,200);assert.equal(r.data.status,'preview_only');assert.equal(r.data.sent,false);
 assert.equal(r.data.binding.send_status,'not_enabled');assert.equal(r.data.binding.preparation_only,true);assert.match(r.data.text,/青鳥數位.*您好/);assert.match(r.data.text,/包裹/);assert.match(r.data.text,/2026/);
 assert.equal(requests,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM line_outbox').get().n,before);
 assert.deepEqual(f.db.sqlite.prepare("SELECT status,version FROM mail_items WHERE id='mail-demo'").get(),original);
 assert.equal((await a(mailPath+'mail-preview/no-such-mail')).status,404);
 f.db.sqlite.prepare("UPDATE businesses SET is_tenant=1 WHERE id='b1'").run();
 assert.equal((await a('/businesses/b1/mail-preview/mail-demo')).status,404);
 f.db.sqlite.prepare("UPDATE mail_items SET status='collected' WHERE id='mail-demo'").run();
 assert.match((await a(mailPath+'mail-preview/mail-demo')).data.notice,/已交付或退回/);
});
test('one observed LINE recipient can represent multiple tenants without inheriting paid digital services',async t=>{
 const f=await fixture(t),a=await f.as('owner-a'),id=await observedMailContact(f);
 f.db.sqlite.prepare("UPDATE businesses SET is_tenant=1 WHERE id='b1'").run();
 const before=f.db.sqlite.prepare('SELECT count(*) n FROM subscriptions').get().n;
 assert.equal((await a(mailPath+'mail-line','POST',mailBind(id))).status,200);
 assert.equal((await a('/businesses/b1/mail-line','POST',mailBind(id))).status,200);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tenant_mail_line_recipients').get().n,2);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM subscriptions').get().n,before);
 f.db.sqlite.prepare("UPDATE line_connections SET enabled=0 WHERE id='la'").run();
 assert.equal((await a(mailPath+'mail-line')).data.recipient.channel_enabled,false);
 assert.equal((await a(mailPath+'mail-preview/mail-demo')).data.sent,false);
});

import {lineSecret,encryptLineSecret} from '../dist/line-credentials.js';
import {lineSettingsRoute} from '../dist/line-settings.js';
import {provisionLineSettings,verifyLineBoundary,waitLineBoundary} from '../scripts/line-settings-deploy.mjs';
const oaSecret='a'.repeat(32),oaToken='t'.repeat(80),oaBot='U'+'d'.repeat(32),oaChannel='1234567890';
async function oaFixture(t){
 const f=await fixture(t);f.env.LINE_CREDENTIALS_KEY=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');f.env.LINE_SEND_ENABLED='off';
 const http=[];
 f.env.HTTP=async(url,init={})=>{
  http.push({url,method:init.method||'GET'});
  assert.equal(init.redirect,'error');
  if(url==='https://api.line.me/v2/oauth/verify'){
   assert.equal(init.method,'POST');assert.equal(new URLSearchParams(init.body).get('access_token'),oaToken);
   return Response.json({client_id:oaChannel,expires_in:999999});
  }
  assert.equal(url,'https://api.line.me/v2/bot/info');assert.equal(init.headers.Authorization,'Bearer '+oaToken);return Response.json({userId:oaBot,displayName:'業者測試 OA'});
 };
 const a=await f.as('owner-a');
 const data={name:'業者自己的 OA',provider_id:'123456789',channel_id:oaChannel,channel_secret:oaSecret,channel_access_token:oaToken,reference:'業者管理員授權接收（虛構測試）'};
 return {...f,http,a,data};
}
test('OA setup encrypts credentials, verifies channel ownership and works with the existing signed webhook receiver',async t=>{
 const f=await oaFixture(t),r=await f.a('/line/settings','POST',f.data);assert.equal(r.status,201);
 const c=r.data.connections.find(c=>c.channel_id===oaChannel);assert.equal(c.enabled,true);assert.match(c.webhook_url,/api\/line\/webhook\//);assert.equal(c.last_webhook_at,null);
 assert(!JSON.stringify(r.data).includes(oaSecret));assert(!JSON.stringify(r.data).includes(oaToken));
 const encrypted=f.db.sqlite.prepare('SELECT encrypted_value FROM line_connection_secrets WHERE connection_id=?').get(c.id).encrypted_value;
 assert(!encrypted.includes(oaSecret));assert(!encrypted.includes(oaToken));assert.equal((await lineSecret(f.env,c.id)).channelAccessToken,oaToken);
 const raw=JSON.stringify({destination:oaBot,events:[]});
 const received=await worker.fetch(new Request('http://localhost/api/line/webhook/'+c.id,{method:'POST',headers:{'x-line-signature':await signature(raw,oaSecret)},body:raw}),f.env);
 assert.equal(received.status,200);assert((await f.a('/line/settings')).data.connections.find(x=>x.id===c.id).last_webhook_at);
 const event=message('configured-channel','configured-msg','真實來源的虛構收件聯絡人',Date.now(),'U'+'e'.repeat(32));
 const eventRaw=JSON.stringify({destination:oaBot,events:[event]});
 assert.equal((await worker.fetch(new Request('http://localhost/api/line/webhook/'+c.id,{method:'POST',headers:{'x-line-signature':await signature(eventRaw,oaSecret)},body:eventRaw}),f.env)).status,200);
 const candidates=(await f.a('/businesses/b4/mail-line/candidates')).data.items;assert(candidates.some(x=>x.connection_id===c.id));
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM line_outbox').get().n,0);assert(f.http.every(x=>!x.url.includes('/message/')));
 const audit=f.db.sqlite.prepare("SELECT detail FROM activity_events WHERE action LIKE 'line_connection_%'").all();assert(!JSON.stringify(audit).includes(oaSecret));assert(!JSON.stringify(audit).includes(oaToken));
 assert.equal((await f.a('/line/settings','POST',f.data)).status,409);
});
test('OA configuration rejects nonowners, forged fields, CSRF, unsupported environments and invalid channel tokens',async t=>{
 const f=await oaFixture(t);
 for(const user of ['sales-a1','service-a','finance-a','platform','business-admin']){
  const u=await f.as(user);assert.equal((await u('/line/settings')).status,403);assert.equal((await u('/line/settings','POST',f.data)).status,403);
 }
 for(const patch of [{actor_id:'owner-b'},{operator_id:'op-b'},{enabled:true},{webhook_url:'https://evil.invalid'},{channel_secret:'bad'}])assert.equal((await f.a('/line/settings','POST',{...f.data,...patch})).status,400);
 assert.equal((await f.a('/line/settings','POST',{...f.data,channel_id:'999999'})).status,400);
 f.env.HTTP=async()=>Response.json({error:oaToken},{status:401});
 const failed=await f.a('/line/settings','POST',f.data);assert.equal(failed.status,400);assert(!JSON.stringify(failed).includes(oaToken));
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM line_connection_secrets').get().n,0);
 delete f.env.LINE_CREDENTIALS_KEY;assert.equal((await f.a('/line/settings')).data.storage_ready,false);assert.equal((await f.a('/line/settings','POST',f.data)).status,503);
 await assert.rejects(()=>lineSettingsRoute(new Request('http://localhost/api/line/settings',{method:'POST'}),{...f.env,APP_ENV:'sandbox'},f.a),/業者管理員/);
 await assert.rejects(()=>lineSettingsRoute(new Request('http://localhost/api/line/settings',{method:'POST'}),{...f.env,APP_ENV:'sandbox'},{id:'owner-a',operator_id:'op-a',role:'operator_owner'}),/測試區/);
});
test('OA edits retain blank credentials, invalidate webhook proof after secret rotation, and use versioned operator isolation',async t=>{
 const f=await oaFixture(t);const result=await f.a('/line/settings','POST',f.data),c=result.data.connections.find(c=>c.channel_id===oaChannel);
 const b=await f.as('owner-b');assert.equal((await b('/line/settings')).data.connections.some(x=>x.id===c.id),false);
 assert.equal((await b('/line/settings/'+c.id,'PATCH',{version:1,name:'偷改',reference:'x'})).status,404);
 const unchanged=await f.a('/line/settings/'+c.id,'PATCH',{version:1,name:'已更新名稱',reference:'更新名稱'});
 assert.equal(unchanged.status,200);assert.equal((await lineSecret(f.env,c.id)).channelAccessToken,oaToken);
 const updated=unchanged.data.connections.find(x=>x.id===c.id);assert.equal(updated.version,2);
 assert.equal((await f.a('/line/settings/'+c.id,'PATCH',{version:1,name:'stale',reference:'x'})).status,409);
 assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM activity_events WHERE action='line_connection_updated'").get().n,1);
 f.db.sqlite.prepare('UPDATE line_connections SET last_webhook_at=? WHERE id=?').run(new Date().toISOString(),c.id);
 const rotated=await f.a('/line/settings/'+c.id,'PATCH',{version:2,name:'已更新名稱',channel_secret:'b'.repeat(32),reference:'輪換驗簽密鑰'});
 assert.equal(rotated.status,200);assert.equal(rotated.data.connections.find(x=>x.id===c.id).last_webhook_at,null);
 const stop=await f.a('/line/settings/'+c.id+'/status','PATCH',{version:3,enabled:false,reference:'停止接收'});
 assert.equal(stop.status,200);
 const raw=JSON.stringify({destination:oaBot,events:[]});
 assert.equal((await worker.fetch(new Request('http://localhost/api/line/webhook/'+c.id,{method:'POST',headers:{'x-line-signature':await signature(raw,'b'.repeat(32))},body:raw}),f.env)).status,404);
 const service=await f.as('service-a');assert.equal((await service('/activity')).status,403);
 const visible=await service('/activity?business_id=b4');assert.equal(visible.status,200);assert(visible.data.every(e=>!e.action.startsWith('line_connection_')));
});
test('encrypted OA secrets fail closed when key, ciphertext or channel/operator context changes',async t=>{
 const f=await oaFixture(t);const r=await f.a('/line/settings','POST',f.data),c=r.data.connections.find(c=>c.channel_id===oaChannel);
 const record=f.db.sqlite.prepare('SELECT encrypted_value FROM line_connection_secrets WHERE connection_id=?').get(c.id);
 const key=f.env.LINE_CREDENTIALS_KEY;f.env.LINE_CHANNELS_JSON=JSON.stringify({[c.id]:{channelSecret:oaSecret,channelAccessToken:oaToken}});
 f.env.LINE_CREDENTIALS_KEY=Buffer.alloc(32,7).toString('base64');assert.deepEqual(await lineSecret(f.env,c.id),{});
 f.env.LINE_CREDENTIALS_KEY=key;
 f.db.sqlite.prepare('UPDATE line_connection_secrets SET encrypted_value=? WHERE connection_id=?').run(await encryptLineSecret(f.env,'op-b',c.id,{channelSecret:oaSecret,channelAccessToken:oaToken}),c.id);
 assert.deepEqual(await lineSecret(f.env,c.id),{});f.db.sqlite.prepare('UPDATE line_connection_secrets SET encrypted_value=? WHERE connection_id=?').run(record.encrypted_value,c.id);
 assert.equal((await lineSecret(f.env,c.id)).channelSecret,oaSecret);
 const checked=await f.a('/line/settings/'+c.id+'/check','POST',{version:1});assert.equal(checked.status,200);
 assert.equal(checked.data.connections.find(x=>x.id===c.id).last_webhook_at,null);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM line_outbox').get().n,0);
});
test('OA resource provisioning preserves the root Access app, limits bypass to signed webhook path and never rotates an existing key',async()=>{
 const config={name:'taiwan-startup-park',account_id:'a'.repeat(32),vars:{APP_ENV:'production',APP_ORIGIN:'https://taiwan-startup-park.fangwl591021.workers.dev',ACCESS_AUD:'owner-aud',LINE_SEND_ENABLED:'off'},d1_databases:[{database_id:'db-id',database_name:'taiwan-startup-park-prod'}]};
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'fake'},calls=[];let secret=true,app=false,policy=false,encryptedCount=0;
 const root={id:'root',aud:'owner-aud',domain:'taiwan-startup-park.fangwl591021.workers.dev',type:'self_hosted'};
 const narrow={id:'webhook',type:'self_hosted',domain:root.domain+'/api/line/webhook/*'};
 async function fake(url,init){
  const path=new URL(url).pathname.split('/accounts/'+env.CLOUDFLARE_ACCOUNT_ID)[1];calls.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});let result;
  if(path==='/workers/subdomain')result={subdomain:'fangwl591021'};
  else if(path==='/d1/database/db-id')result={name:'taiwan-startup-park-prod',uuid:'db-id'};
  else if(path==='/d1/database/db-id/query')result=[{success:true,results:[{n:encryptedCount}]}];
  else if(path==='/workers/scripts/taiwan-startup-park/secrets'){
   assert.equal(init.method,'PUT');const d=JSON.parse(init.body);assert.equal(d.name,'LINE_CREDENTIALS_KEY');assert.equal(Buffer.from(d.text,'base64').length,32);secret=true;result={name:d.name,type:'secret_text'};
  }
  else if(path==='/workers/scripts/taiwan-startup-park/settings')result={bindings:[{type:'d1',name:'DB',id:'db-id'},...(secret?[{type:'secret_text',name:'LINE_CREDENTIALS_KEY'}]:[])]};
  else if(path==='/access/apps') {app=true;assert.equal(JSON.parse(init.body).domain,narrow.domain);result=narrow;}
  else if(path==='/access/apps/root/policies'){assert.equal(init.method,'GET');result=[{decision:'allow'}];}
  else if(path==='/access/apps/webhook/policies'){
   if(init.method==='POST'){policy=true;assert.equal(JSON.parse(init.body).decision,'bypass');result={id:'policy'};}
   else result=policy?[{decision:'bypass',include:[{everyone:{}}],exclude:[],require:[]}]:[];
  }else if(path==='/access/apps')result=narrow;
  else if(path.startsWith('/access/apps?'))throw Error('pathname excludes query');
  else if(path==='/access/apps' || new URL(url).search)result=[root,...(app?[narrow]:[])];
  else throw Error(path);
  return Response.json({success:true,result});
 }
 // Handle list before create: same pathname, GET has pagination.
 const fetcher=async(url,init)=>init.method==='GET'&&new URL(url).pathname.endsWith('/access/apps')?Response.json({success:true,result:[root,...(app?[narrow]:[])]}):fake(url,init);
 const result=await provisionLineSettings(env,config,fetcher);assert.equal(result.credential_key_present,true);assert.equal(result.key_created,false);assert.equal(result.webhook_domain,narrow.domain);assert(!calls.some(x=>x.path.endsWith('/secrets')));
 secret=false;assert.equal((await provisionLineSettings(env,config,fetcher)).key_created,true);
 assert.equal((await provisionLineSettings(env,config,fetcher)).key_created,false);assert.equal(calls.filter(x=>x.path.endsWith('/secrets')).length,1);
 secret=false;encryptedCount=1;await assert.rejects(()=>provisionLineSettings(env,config,fetcher),/拒絕重建/);assert.equal(calls.filter(x=>x.path.endsWith('/secrets')).length,1);
 const checks=await verifyLineBoundary(async(url,init)=>url.includes('/webhook/')?new Response(null,{status:404}):new Response(null,{status:302,headers:{location:'https://test.cloudflareaccess.com/login'}}));
 assert.equal(checks.length,7);assert(checks.slice(1).every(x=>x.access_protected));
 let probes=0,waits=0;
 const eventual=await waitLineBoundary(async url=>url.includes('/webhook/')&&++probes>1?new Response(null,{status:404}):new Response(null,{status:302,headers:{location:'https://test.cloudflareaccess.com/login'}}),async()=>{waits++;});
 assert.equal(eventual.length,7);assert.equal(probes,2);assert.equal(waits,1);
 await assert.rejects(()=>provisionLineSettings(env,{...config,name:'other-worker'},fetcher),/目標/);
 await assert.rejects(()=>verifyLineBoundary(async()=>new Response(null,{status:302,headers:{location:'https://test.cloudflareaccess.com/login'}})),/Webhook/);
});
