import test from 'node:test';
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
 db.sqlite.exec("INSERT INTO line_connections VALUES('la','op-a','provider-a','channel-a','dest-a',1),('lb','op-b','provider-b','channel-b','dest-b',1)");
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
