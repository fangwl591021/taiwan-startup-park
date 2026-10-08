import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from '../scripts/database.mjs';
import setup from '../dist/owner-setup.js';
import worker from '../dist/worker.js';
import {digest} from '../dist/shared.js';
import {prepareOwnerSetup} from '../scripts/owner-setup.mjs';
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pub={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'setup-key',alg:'RS256',use:'sig'};
async function fixture(t){
 const db=database();t.after(()=>db.close());
 const env={DB:db,APP_ENV:'production',DEMO_MODE:'off',APP_ORIGIN:'https://setup.example.invalid',ACCESS_ISSUER:'https://test-'+crypto.randomUUID()+'.cloudflareaccess.com',ACCESS_AUD:'test-aud',INITIAL_OWNER_EMAIL_HASH:await digest('owner@example.invalid'),OWNER_SETUP_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),HTTP:async()=>Response.json({keys:[pub]})};
 async function jwt(patch={}){
  const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'setup-key'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:env.ACCESS_ISSUER,aud:[env.ACCESS_AUD],sub:'approved-sub',email:'owner@example.invalid',exp:Math.floor(Date.now()/1000)+3600,...patch})).toString('base64url');
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(h+'.'+p));
  return h+'.'+p+'.'+Buffer.from(signature).toString('base64url');
 }
 async function call({token,claims={},data={},environment=env,origin=env.APP_ORIGIN,path='/api/setup/enroll',method='POST',implementation=setup,cookie=''}={}){
  const response=await implementation.fetch(new Request(env.APP_ORIGIN+path,{method,headers:{'cf-access-jwt-assertion':token??await jwt(claims),'content-type':'application/json',origin,'x-requested-with':'tsp',cookie},...(method==='POST'?{body:JSON.stringify(data)}:{})}),environment);
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 return {db,env,jwt,call};
}
test('preapproved signed identity initializes one owner and audit atomically; repeat does not duplicate',async t=>{
 const {db,call}=await fixture(t);
 const results=await Promise.all([call(),call()]);assert(results.every(r=>r.status===200));
 for(const table of ['operators','staff_users','auth_identities','activity_events'])assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,1);
 assert.equal(db.sqlite.prepare('SELECT role FROM staff_users').get().role,'operator_owner');
 assert.equal(db.sqlite.prepare('SELECT subject FROM auth_identities').get().subject,'approved-sub');
 assert.equal((await call({claims:{sub:'second-sub'}})).status,409);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM auth_identities').get().n,1);
});
test('wrong or missing signed email, forged signature, expired claims and wrong audience create nothing',async t=>{
 const {db,call,jwt}=await fixture(t);
 for(const claims of [{email:'other@example.invalid'},{email:null},{exp:1},{aud:['other']}])assert([401,403].includes((await call({claims})).status));
 const token=await jwt();const parts=token.split('.');parts[2]='A'.repeat(parts[2].length);
 assert.equal((await call({token:parts.join('.')})).status,401);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_users').get().n,0);
});
test('setup expiry, absent configuration, cross-origin and client role fields fail closed',async t=>{
 const {db,env,call}=await fixture(t);
 assert.equal((await call({environment:{...env,OWNER_SETUP_EXPIRES_AT:'2000-01-01'}})).status,403);
 assert.equal((await call({environment:{...env,INITIAL_OWNER_EMAIL_HASH:undefined}})).status,503);
 assert.equal((await call({origin:'https://evil.example'})).status,403);
 for(const data of [{role:'platform_admin'},{operator_id:'other'},[]])assert.equal((await call({data})).status,400);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM operators').get().n,0);
});
test('existing staff or revoked owner cannot be overwritten or reactivated',async t=>{
 const {db,call}=await fixture(t);seed(db);
 assert.equal((await call()).status,409);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM auth_identities').get().n,0);
 const second=await fixture(t);await second.call();second.db.sqlite.exec("UPDATE staff_users SET active=0");
 assert.equal((await second.call()).status,409);
 assert.equal(second.db.sqlite.prepare('SELECT active FROM staff_users').get().active,0);
});
test('setup Worker exposes no customer API; bound owner can use normal production login',async t=>{
 const {call,env}=await fixture(t);
 for(const path of ['/api/me','/api/opportunities','/api/demo/users'])assert.equal((await call({path,method:'GET'})).status,404);
 await call();
 const login=await call({implementation:worker,path:'/api/auth/access'});assert.equal(login.status,200);
 const me=await call({implementation:worker,path:'/api/me',method:'GET',cookie:login.cookie.split(';')[0]});
 assert.equal(me.status,200);assert.equal(me.data.role,'operator_owner');assert.equal(me.data.demo,false);
});
function fakeCloudflare({staff=0,owners=0,policies=[],wrongDatabase=false,bindings=[],platformName='taiwan-startup-park-platform-prod'}={}){
 const resources={worker:'taiwan-startup-park',hostname:'taiwan-startup-park.fangwl591021.workers.dev',D1_DATABASE_ID:'2c2ef714-429f-4ac2-9a4b-417a242627fb',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUD:'a'.repeat(64),access_application_id:'app'};
 const env={CLOUDFLARE_API_TOKEN:'test-token',CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),INITIAL_OWNER_EMAIL:'owner@example.invalid'};
 resources.PLATFORM_DATABASE_ID='bce2ab64-bc4e-4c69-b2b7-5af1fb4700d4';
 const calls=[],rules=[...policies];
 const fetcher=async(url,options)=>{
  const path=url.split('/accounts/'+env.CLOUDFLARE_ACCOUNT_ID)[1];calls.push({path,method:options.method});
  let result;
  if(path==='/workers/subdomain')result={subdomain:'fangwl591021'};
  else if(path==='/d1/database/'+resources.D1_DATABASE_ID)result={name:wrongDatabase?'other':'taiwan-startup-park-prod'};
  else if(path==='/d1/database/'+resources.PLATFORM_DATABASE_ID)result={name:platformName,uuid:resources.PLATFORM_DATABASE_ID};
  else if(path==='/access/organizations')result={auth_domain:'test.cloudflareaccess.com'};
  else if(path==='/access/apps/app')result={domain:resources.hostname,aud:resources.ACCESS_AUD,type:'self_hosted'};
  else if(path.endsWith('/settings'))result={bindings};
  else if(path.endsWith('/query'))result=[{success:true,results:[{operators:staff?1:0,staff,identities:owners,owners}]}];
  else if(path.endsWith('/policies')){if(options.method==='POST')rules.push(JSON.parse(options.body));result=options.method==='POST'?rules.at(-1):rules;}
  else if(path.endsWith('/deployments'))result={deployments:[]};
  else throw new Error('Unexpected API call');
  return Response.json({success:true,result});
 };
 return {resources,env,fetcher,calls};
}
test('runtime owner preflight accepts the exact two existing databases using reads only',async()=>{
 const bindings=[{type:'d1',name:'DB',id:'2c2ef714-429f-4ac2-9a4b-417a242627fb'},{type:'d1',name:'PLATFORM_DB',id:'bce2ab64-bc4e-4c69-b2b7-5af1fb4700d4'}];
 const f=fakeCloudflare({staff:1,owners:1,bindings});
 assert.deepEqual(await prepareOwnerSetup(f.env,f.resources,{name:'taiwan-startup-park',main:'dist/worker.js'},f.fetcher),{ready:true});
 assert(f.calls.every(c=>c.method==='GET'||c.path.endsWith('/query')));assert(!f.calls.some(c=>c.path.endsWith('/policies')));
});
test('runtime preflight rejects wrong, missing or duplicate database bindings before inspecting owner data',async()=>{
 const root={type:'d1',name:'DB',id:'2c2ef714-429f-4ac2-9a4b-417a242627fb'},platform={type:'d1',name:'PLATFORM_DB',id:'bce2ab64-bc4e-4c69-b2b7-5af1fb4700d4'};
 for(const bindings of [[root,{...platform,id:'foreign'}],[root,{...platform,id:root.id}],[platform],[root,{...platform,name:'OTHER'}],[root,root]]){
  const f=fakeCloudflare({staff:1,owners:1,bindings});await assert.rejects(prepareOwnerSetup(f.env,f.resources,{name:'taiwan-startup-park',main:'dist/worker.js'},f.fetcher),/資料庫/);
  assert(!f.calls.some(c=>c.path.endsWith('/query')));
 }
 const f=fakeCloudflare({staff:1,owners:1,bindings:[root,platform],platformName:'other-project'});await assert.rejects(prepareOwnerSetup(f.env,f.resources,{name:'taiwan-startup-park',main:'dist/worker.js'},f.fetcher),/身分/);
});
test('existing complete runtime with no active owner never falls back to a setup deployment',async()=>{
 const f=fakeCloudflare({bindings:[{type:'d1',name:'DB',id:'2c2ef714-429f-4ac2-9a4b-417a242627fb'},{type:'d1',name:'PLATFORM_DB',id:'bce2ab64-bc4e-4c69-b2b7-5af1fb4700d4'}]});
 await assert.rejects(prepareOwnerSetup(f.env,f.resources,{name:'taiwan-startup-park',main:'dist/worker.js'},f.fetcher),/停止首次初始化/);assert(!f.calls.some(c=>c.path.endsWith('/policies')));
});
test('initialization pipeline limits policy to secret email and removes assets; valid owner skips setup',async()=>{
 const f=fakeCloudflare();const r=await prepareOwnerSetup(f.env,f.resources,{name:'taiwan-startup-park',main:'dist/worker.js',assets:{directory:'dist/public'}},f.fetcher);
 assert.equal(r.ready,false);assert.equal(r.config.main,'dist/owner-setup.js');assert.equal(r.config.assets,undefined);assert.equal(r.config.vars.DEMO_MODE,'off');
 assert(!JSON.stringify(r).includes(f.env.INITIAL_OWNER_EMAIL));
 assert.equal(r.config.vars.INITIAL_OWNER_EMAIL_HASH,await digest(f.env.INITIAL_OWNER_EMAIL));
 const bound=fakeCloudflare({staff:1,owners:1});
 assert.deepEqual(await prepareOwnerSetup(bound.env,bound.resources,{name:'taiwan-startup-park',main:'dist/worker.js'},bound.fetcher),{ready:true});
 assert(!bound.calls.some(c=>c.path.endsWith('/policies')));
});
test('existing unbound staff, broad policy and wrong database stop before policy mutation',async()=>{
 for(const options of [{staff:1},{policies:[{decision:'bypass'}]},{policies:[{decision:'allow',include:[{everyone:{}}]}]},{wrongDatabase:true}]){
  const f=fakeCloudflare(options);
  await assert.rejects(prepareOwnerSetup(f.env,f.resources,{name:'taiwan-startup-park',main:'dist/worker.js'},f.fetcher));
  assert(!f.calls.some(c=>c.path.endsWith('/policies')&&c.method==='POST'));
 }
});
