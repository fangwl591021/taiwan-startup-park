import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../reports/platform-test-worker.mjs';
import {database,seed} from '../../scripts/database.mjs';
import {platformDatabase} from '../../platform/runtime/test-database.mjs';
import {privateAssetBucket} from '../../platform/runtime/private-assets.mjs';
async function fixture(t){
 const db=database();seed(db);const p=platformDatabase();t.after(()=>{db.close();p.close();});
 const env={DB:db,PLATFORM_DB:p,PLATFORM_RUNTIME_ENABLED:'on',APP_ENV:'local',DEMO_MODE:'on',LINE_CREDENTIALS_KEY:Buffer.alloc(32,42).toString('base64')};
 const wait=[];
 async function request(path,method='GET',data,cookie='',extra={}){const r=await worker.fetch(new Request('http://localhost'+path,{method,headers:{cookie,origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp',...extra},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env,{waitUntil(p){wait.push(p);}});let payload;try{payload=await r.json()}catch{payload=null;}await Promise.allSettled(wait.splice(0));return{status:r.status,data:payload,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function as(id){const login=await request('/api/demo/login','POST',{user_id:id});assert.equal(login.status,200);return{root:(path,method='GET',data,headers)=>request('/api'+path,method,data,login.cookie,headers),api:(ws,path,method='GET',data,headers)=>request('/api/platform-runtime/'+ws+path,method,data,login.cookie,headers),cookie:login.cookie};}
 return{db,p,env,as,request};
}
test('actual Hono runtime uses root HttpOnly identity and ignores forged workspace/bearer roles',async t=>{
 const{as,p}=await fixture(t);const owner=await as('owner-a');
 let r=await owner.api('pw-op-op-a','/api/auth/me','GET',undefined,{'x-workspace-id':'default',authorization:'Bearer forged','x-role':'owner'});
 assert.equal(r.status,200);assert.equal(r.data.activeWorkspaceId,'tsp-operator-op-a');assert.equal(r.data.user.id,'owner-a');assert.equal(r.data.memberships.length,1);assert.equal(r.data.user.is_system_admin,0);
 r=await owner.api('pw-op-op-a','/api/projects');assert.equal(r.status,200);assert.deepEqual(r.data.projects,[]);
 assert.equal((await owner.api('pw-op-op-b','/api/projects')).status,404);
 assert.equal(p.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE id='default'").get().n,0);
 assert.equal(p.sqlite.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);
});
test('real CRM/commerce endpoints are durable and cannot cross operators',async t=>{
 const{as}=await fixture(t);const a=await as('owner-a'),b=await as('owner-b');
 const created=await a.api('pw-op-op-a','/api/commerce/products','POST',{sku:'TEST-PARK-ONLY',name:'虛構商品',description:'純測試',priceAmountMinor:100});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const list=await a.api('pw-op-op-a','/api/commerce/products');assert.equal(list.status,200);assert.equal(list.data.products.length,1);
 const other=await b.api('pw-op-op-b','/api/commerce/products');assert.equal(other.status,200);assert.equal(other.data.products.length,0);
 const crm=await a.api('pw-op-op-a','/api/crm/people');assert.equal(crm.status,200,JSON.stringify(crm.data));
 const summary=await a.api('pw-op-op-a','/api/startup-park/summary');assert.equal(summary.data.products,1);assert.equal(summary.data.orders,0);assert.equal(summary.data.integrations.line,'not_configured');
});
test('employees and platform administrator cannot become retail workspace owners',async t=>{
 const{as}=await fixture(t);
 for(const id of ['sales-a3','service-a','finance-a','platform']){const a=await as(id);const r=await a.api('pw-biz-b4','/api/projects');assert([403,404].includes(r.status),id);}
 const a=await as('owner-a');assert.equal((await a.api('pw-biz-b4','/api/projects')).status,403);
 for(const path of ['/api/system/workspaces','/api/member/orders','/api/intelligence/conversions','/auth/register'])assert.equal((await a.api('pw-op-op-a',path)).status,404);
 assert.equal((await a.api('pw-op-op-a','/api/members','POST',{role:'owner'})).status,409);
});
test('enterprise authorization and module grants are separate, revoked memberships stop immediately',async t=>{
 const{as,db}=await fixture(t);const owner=await as('owner-a'),enterprise=await as('business-admin');
 assert.equal((await enterprise.api('pw-biz-b4','/api/projects')).status,404);
 assert.equal((await owner.root('/platform-workspaces/pw-biz-b4/members/business-admin','PUT',{active:true,version:0,reference:'TEST ONLY explicit customer consent'})).status,200);
 assert.equal((await enterprise.api('pw-biz-b4','/api/projects')).status,409);
 db.sqlite.prepare("UPDATE platform_workspace_entitlements SET enabled=1,version=version+1 WHERE workspace_id='pw-biz-b4' AND module='CORE_MENU'").run();
 assert.equal((await enterprise.api('pw-biz-b4','/api/projects')).status,200);
 assert.equal((await enterprise.api('pw-biz-b4','/api/commerce/products')).status,403);
 assert.equal((await enterprise.api('pw-op-op-a','/api/projects')).status,404);
 db.sqlite.prepare("UPDATE platform_workspace_entitlements SET enabled=0,version=version+1 WHERE workspace_id='pw-biz-b4'").run();assert.equal((await enterprise.api('pw-biz-b4','/api/projects')).status,409);
 await owner.root('/platform-workspaces/pw-biz-b4/members/business-admin','PUT',{active:false,version:1,reference:'TEST ONLY revoked consent'});assert.equal((await enterprise.api('pw-biz-b4','/api/projects')).status,404);
});
test('suspended workspaces, disabled actors and CSRF fail before source writes',async t=>{
 const{as,db,p}=await fixture(t);const a=await as('owner-a');
 assert.equal((await a.api('pw-op-op-a','/api/templates','POST',{name:'forged'},{origin:'https://attacker.invalid'})).status,403);
 await a.root('/platform-workspaces/pw-op-op-a','PATCH',{status:'suspended',version:1,reference:'TEST ONLY suspended'});
 assert.equal((await a.api('pw-op-op-a','/api/projects')).status,409);
 db.sqlite.prepare("UPDATE platform_workspaces SET status='active' WHERE id='pw-op-op-a'").run();db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='owner-a'").run();assert.equal((await a.api('pw-op-op-a','/api/projects')).status,401);
 assert.equal(p.sqlite.prepare('SELECT COUNT(*) n FROM projects').get().n,0);
});
test('private small-image storage has workspace and size isolation, no public cache',async t=>{
 const{as,p}=await fixture(t);const a=await as('owner-a'),b=await as('owner-b');await a.api('pw-op-op-a','/api/projects');await b.api('pw-op-op-b','/api/projects');
 const bucket=privateAssetBucket(p,'tsp-operator-op-a'),key='templates/tsp-operator-op-a/fixture/image.png';
 const bytes=new Uint8Array([1,2,3]);await bucket.put(key,bytes,{httpMetadata:{contentType:'image/png'}});assert.deepEqual(new Uint8Array(await(await bucket.get(key)).arrayBuffer()),bytes);
 await assert.rejects(privateAssetBucket(p,'tsp-operator-op-b').get(key),/ASSET_SCOPE_DENIED/);
 await assert.rejects(bucket.put(key,new Uint8Array(1048577)),/1 MB/);
});
test('OA credentials are encrypted and blank saves retain values; receive/send are never falsely enabled',async t=>{
 const{as,p}=await fixture(t);const a=await as('owner-a');
 const r=await a.api('pw-op-op-a','/api/line-hub/account','PATCH',{oaName:'虛構 OA',lineLoginChannelId:'123456',lineBotChannelId:'234567',lineLoginChannelSecret:'TEST_LOGIN_SECRET',lineBotChannelSecret:'TEST_WEBHOOK_SECRET',lineBotChannelAccessToken:'TEST_ACCESS_TOKEN',status:'connected',webhookEnabled:true});
 assert.equal(r.status,200,JSON.stringify(r.data));
 const stored=p.sqlite.prepare("SELECT * FROM workspace_line_accounts WHERE workspace_id='tsp-operator-op-a'").get();assert(!JSON.stringify(stored).includes('TEST_'));assert.equal(stored.webhook_enabled,0);assert.equal(stored.status,'disconnected');
 const view=await a.api('pw-op-op-a','/api/line-hub');assert.equal(view.status,200);assert(view.data.lineAccount.hasLoginSecret);assert(!JSON.stringify(view.data).includes('TEST_'));
 await a.api('pw-op-op-a','/api/line-hub/account','PATCH',{lineLoginChannelSecret:'',lineBotChannelSecret:'',lineBotChannelAccessToken:''});
 assert.equal(p.sqlite.prepare("SELECT line_login_channel_secret FROM workspace_line_accounts WHERE workspace_id='tsp-operator-op-a'").get().line_login_channel_secret,stored.line_login_channel_secret);
 assert.equal((await a.api('pw-op-op-a','/api/projects/unknown/publish','POST',{})).status,503);
});
test('website drafts escape untrusted material, keep source/version, and refuse cross-workspace and unpaid publication',async t=>{
 const{as}=await fixture(t);const a=await as('owner-a'),b=await as('owner-b');
 let r=await a.api('pw-op-op-a','/api/site-drafts','POST',{name:'<script>alert(1)</script>',description:'<img onerror=alert(1)>',social_urls:['https://example.com/demo'],asset_ids:[]});assert.equal(r.status,201,JSON.stringify(r.data));const id=r.data.item.id;assert(!r.data.preview.includes('<script>'));assert(r.data.preview.includes('&lt;script&gt;'));
 assert.equal((await b.api('pw-op-op-b','/api/site-drafts/'+id)).status,404);
 assert.equal((await a.api('pw-op-op-a','/api/site-drafts/'+id+'/confirm','POST',{version:1})).status,200);
 assert.equal((await a.api('pw-op-op-a','/api/site-drafts/'+id+'/confirm','POST',{version:1})).status,409);
 assert.equal((await a.api('pw-op-op-a','/api/site-drafts/'+id+'/publish','POST',{})).status,409);
 r=await a.api('pw-op-op-a','/api/site-drafts','POST',{name:'x',description:'',social_urls:['javascript:alert(1)'],asset_ids:[]});assert.equal(r.status,400);
 r=await a.api('pw-op-op-a','/api/site-drafts','POST',{name:'x',description:'',social_urls:[],asset_ids:['foreign']});assert.equal(r.status,404);
});

test('borrowed CRM bridge includes real term dates and never leaks another operator',async t=>{
 const{as}=await fixture(t);const a=await as('owner-a'),b=await as('owner-b');
 const own=await a.api('pw-op-op-a','/api/startup-park/borrowed-enterprises');assert.equal(own.status,200);assert.equal(own.data.items.length,1);assert.equal(own.data.items[0].id,'b4');assert('service_starts_on' in own.data.items[0]);assert('term_kind' in own.data.items[0]);
 const other=await b.api('pw-op-op-b','/api/startup-park/borrowed-enterprises');assert.equal(other.status,200);assert.equal(other.data.items.length,0);
});
