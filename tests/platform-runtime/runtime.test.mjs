import {menuChatRoute} from '../../reports/menu-chat-routes.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../reports/platform-test-worker.mjs';
import {database,seed} from '../../scripts/database.mjs';
import {platformDatabase} from '../../platform/runtime/test-database.mjs';
import {privateAssetBucket} from '../../platform/runtime/private-assets.mjs';
test('public LIFF HTML stays on its endpoint when assets canonicalize HTML paths',async()=>{
 const assets={async fetch(req){const path=new URL(req.url).pathname;if(path.endsWith('.html'))return new Response(null,{status:307,headers:{Location:path.slice(0,-5)}});return path==='/platform/menu-upload'?new Response('<!doctype html><title>Upload fixture</title>',{headers:{'Content-Type':'text/html'}}):new Response('Not found',{status:404});}};
 const url='https://example.com/api/line/webhook/menu-upload/page?menuRun=fixture';
 const r=await worker.fetch(new Request(url),{ASSETS:assets},{});
 assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.match(await r.text(),/Upload fixture/);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/https:\/\/static.line-scdn.net/);
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}),{ASSETS:assets},{})).status,405);
});
async function fixture(t){
 const db=database();seed(db);const p=platformDatabase();t.after(()=>{db.close();p.close();});
 const env={DB:db,PLATFORM_DB:p,PLATFORM_RUNTIME_ENABLED:'on',APP_ENV:'local',DEMO_MODE:'on',LINE_CREDENTIALS_KEY:Buffer.alloc(32,42).toString('base64')};
 const wait=[];
 async function request(path,method='GET',data,cookie='',extra={}){const r=await worker.fetch(new Request('http://localhost'+path,{method,headers:{cookie,origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp',...extra},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env,{waitUntil(p){wait.push(p);}});let payload;try{payload=await r.json()}catch{payload=null;}await Promise.allSettled(wait.splice(0));return{status:r.status,data:payload,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function as(id){const login=await request('/api/demo/login','POST',{user_id:id});assert.equal(login.status,200);return{root:(path,method='GET',data,headers)=>request('/api'+path,method,data,login.cookie,headers),api:(ws,path,method='GET',data,headers)=>request('/api/platform-runtime/'+ws+path,method,data,login.cookie,headers),cookie:login.cookie};}
 return{db,p,env,as,request};
}
test('menu chat admin uses root workspace grants and revision checks; demonstration cannot send LINE',async t=>{
 const {as,p}=await fixture(t),a=await as('owner-a'),b=await as('owner-b'),uid='U'+'a'.repeat(32);
 let r=await a.api('pw-op-op-a','/api/rich-menu-chat/operators');assert.equal(r.status,200);assert.deepEqual(r.data.operators,[]);
 r=await a.api('pw-op-op-a','/api/rich-menu-chat/operators','PUT',{uid,label:'測試管理員',enabled:true,revision:0});assert.equal(r.status,200);
 assert.equal((await a.api('pw-op-op-a','/api/rich-menu-chat/operators','PUT',{uid,label:'stale',enabled:false,revision:0})).status,409);
 assert.deepEqual((await b.api('pw-op-op-b','/api/rich-menu-chat/operators')).data.operators,[]);
 assert.equal((await b.api('pw-op-op-a','/api/rich-menu-chat/operators')).status,404);
 assert.equal((await a.api('pw-op-op-a','/api/rich-menu-chat/connection','PUT',{enabled:true})).status,409);
 assert.equal(p.sqlite.prepare('SELECT COUNT(*) n FROM startup_park_menu_chat_connections').get().n,0);
 assert.equal((await a.api('pw-op-op-a','/api/rich-menu-chat/operators','PUT',{uid,label:'',enabled:false,revision:1})).status,200);
 assert.equal((await a.api('pw-op-op-a','/api/rich-menu-chat/operators')).data.operators[0].enabled,0);
});
test('actual runtime receiver verifies raw signature, bot destination and live root permission; never pushes',async t=>{
 const {as,env,p,db}=await fixture(t),a=await as('owner-a');
 await a.api('pw-op-op-a','/api/line-hub/account','PATCH',{lineBotChannelSecret:'TEST_WEBHOOK_SECRET',lineBotChannelAccessToken:'TEST_ACCESS_TOKEN'});
 env.DEMO_MODE='off';const calls=[],original=globalThis.fetch,bot='U'+'b'.repeat(32);t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url.endsWith('/bot/info'))return Response.json({userId:bot});if(url.endsWith('/message/reply'))return Response.json({});throw Error('Unexpected external request '+url);};
 const c={source_workspace_id:'tsp-operator-op-a',workspace:{operator_id:'op-a'},actor:{id:'owner-a'}};
 assert.equal((await menuChatRoute(new Request('http://localhost',{method:'PUT',body:JSON.stringify({enabled:true})}),env,c,'/api/rich-menu-chat/connection')).status,200);
 const connection={data:await (await menuChatRoute(new Request('http://localhost'),env,c,'/api/rich-menu-chat/connection')).json()};assert.equal(connection.data.enabled,true);
 env.DEMO_MODE='on';const hub=await a.api('pw-op-op-a','/api/line-hub');assert.equal(hub.data.integrationStatus,'configured');assert(hub.data.lineAccount.webhookPath.startsWith('/api/line/webhook/runtime/'));env.DEMO_MODE='off';
 const path=new URL(connection.data.webhookUrl).pathname,key=await crypto.subtle.importKey('raw',new TextEncoder().encode('TEST_WEBHOOK_SECRET'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const payload={destination:bot,events:[{type:'message',source:{type:'user',userId:'U'+'a'.repeat(32)},webhookEventId:'fixture-event',replyToken:'reply',message:{type:'text',text:'修改選單'}}]};
 async function receive(body,sign=true){const raw=JSON.stringify(body),signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('base64');return worker.fetch(new Request('http://localhost'+path,{method:'POST',headers:{'x-line-signature':sign?signature:'invalid'},body:raw}),env,{waitUntil(){throw Error('No publisher should start');}});}
 assert.equal((await receive(payload,false)).status,401);assert.equal(calls.length,1);
 assert.equal((await receive({...payload,destination:'U'+'c'.repeat(32)})).status,400);assert.equal(calls.length,1);
 assert.equal((await receive(payload)).status,200);assert.equal(calls.filter(c=>c.url.endsWith('/message/reply')).length,1);assert(!calls.some(c=>c.url.includes('/message/push')));
 assert.equal((await receive(payload)).status,200);assert.equal(calls.filter(c=>c.url.endsWith('/message/reply')).length,1);
 assert(p.sqlite.prepare('SELECT line_bot_channel_secret FROM workspace_line_accounts').get().line_bot_channel_secret!=='TEST_WEBHOOK_SECRET');
 db.sqlite.prepare("UPDATE platform_workspace_entitlements SET enabled=0 WHERE workspace_id='pw-op-op-a' AND module='CORE_MENU'").run();assert.equal((await receive(payload)).status,404);assert.equal(calls.length,2);
});
test('scheduled recovery marks interrupted work for review without republishing or sending',async t=>{
 const {as,env,p}=await fixture(t),a=await as('owner-a');await a.api('pw-op-op-a','/api/rich-menu-chat/operators');
 const workspace='tsp-operator-op-a',account='lineacct_'+workspace,uid='U'+'a'.repeat(32);
 p.sqlite.prepare("INSERT INTO rich_menu_chat_jobs(id,workspace_id,line_account_id,project_id,line_user_id,event_id,phase,snapshot_json,old_asset_id,old_menu_id,updated_at) VALUES('interrupted',?,?,?,?,'fixture-event','publishing','{}','original','richmenu-fixture','2000-01-01 00:00:00')").run(workspace,account,'fictional',uid);
 p.sqlite.prepare("INSERT INTO rich_menu_chat_sessions(workspace_id,line_account_id,line_user_id,run_id,phase,snapshot_json,expires_at,updated_at) VALUES(?,?,?,'fixture-run','busy','{}',?,'2000-01-01 00:00:00')").run(workspace,account,uid,Date.now()+300000);
 env.DEMO_MODE='off';env.LINE_SEND_ENABLED='off';const promises=[],original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async()=>{throw Error('Recovery must not publish');};
 await worker.scheduled({},env,{waitUntil(p){promises.push(p);}});await Promise.all(promises);
 assert.equal(p.sqlite.prepare("SELECT phase FROM rich_menu_chat_jobs WHERE id='interrupted'").get().phase,'uncertain');assert.equal(p.sqlite.prepare('SELECT phase FROM rich_menu_chat_sessions').get().phase,'uncertain');assert.equal(p.sqlite.prepare('SELECT COUNT(*) n FROM rich_menu_chat_refresh_receipts').get().n,0);
});
test('LIFF upload uses the verified Login channel and authorized UID, keeps runs private, and rejects revoked grants',async t=>{
 const {as,env,p,db}=await fixture(t),a=await as('owner-a'),uid='U'+'a'.repeat(32),workspace='tsp-operator-op-a',account='lineacct_'+workspace;
 await a.api('pw-op-op-a','/api/line-hub/account','PATCH',{lineLoginChannelId:'123456',lineBotChannelSecret:'TEST_SECRET',lineBotChannelAccessToken:'TEST_TOKEN'});
 await a.api('pw-op-op-a','/api/rich-menu-chat/operators','PUT',{uid,label:'fixture',enabled:true,revision:0});
 p.sqlite.prepare('INSERT INTO startup_park_menu_chat_connections(workspace_id,line_account_id,webhook_key,destination,liff_id) VALUES(?,?,?,?,?)').run(workspace,account,crypto.randomUUID(),'U'+'b'.repeat(32),'123456-fixture');
 p.sqlite.prepare('UPDATE workspace_line_accounts SET webhook_enabled=1 WHERE workspace_id=?').run(workspace);
 const run=crypto.randomUUID(),snapshot={project:{id:'fixture-project',workspace_id:workspace,name:'測試選單'},config:{size:{width:2500,height:1686},areas:[{bounds:{x:0,y:0,width:2500,height:1686}}]},areas:[{id:'area-fixture',label:'按鈕',x:0,y:0,width:2500,height:1686}]};
 p.sqlite.prepare("INSERT INTO rich_menu_chat_sessions(workspace_id,line_account_id,line_user_id,run_id,phase,snapshot_json,expires_at) VALUES(?,?,?,?,'upload',?,?)").run(workspace,account,uid,run,JSON.stringify(snapshot),Date.now()+300000);
 env.DEMO_MODE='off';let client='wrong',profile=uid;const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async(url)=>url.endsWith('/verify')?Response.json({client_id:client,scope:'profile',expires_in:300}):Response.json({userId:profile});
 const query=new URLSearchParams({lineAccountId:account,menuRun:run}),call=(path,token='fixture-token')=>worker.fetch(new Request('http://localhost/api/line/webhook/menu-upload/'+path+'?'+query,{headers:token?{Authorization:'Bearer '+token}:{}}),env,{waitUntil(){}});
 assert.equal((await call('session','')).status,401);assert.equal((await call('session')).status,401);
 client='123456';profile='U'+'c'.repeat(32);assert.equal((await call('session')).status,403);
 profile=uid;const result=await call('session');assert.equal(result.status,200);assert.equal((await result.json()).areas[0].id,'area-fixture');
 assert.equal((await call('jobs/'+crypto.randomUUID())).status,404);
 const bootstrap=await call('bootstrap','');assert.equal(bootstrap.status,200);assert(!JSON.stringify(await bootstrap.json()).includes('TEST_TOKEN'));
 db.sqlite.prepare("UPDATE platform_workspace_entitlements SET enabled=0 WHERE workspace_id='pw-op-op-a' AND module='CORE_MENU'").run();assert.equal((await call('session')).status,403);
});
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
 assert.equal((await a.api('pw-op-op-a','/api/projects/unknown/publish','POST',{})).status,409);
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

test('core module permission does not imply CRM, OA or commission data access',async t=>{
 const{as,db}=await fixture(t);const owner=await as('owner-a'),enterprise=await as('business-admin');
 await owner.root('/platform-workspaces/pw-biz-b4/members/business-admin','PUT',{active:true,version:0,reference:'TEST ONLY scoped enterprise'});
 db.sqlite.prepare("UPDATE platform_workspace_entitlements SET enabled=1,version=version+1 WHERE workspace_id='pw-biz-b4' AND module='CRM'").run();
 assert.equal((await enterprise.api('pw-biz-b4','/api/crm/people')).status,200);
 assert.equal((await enterprise.api('pw-biz-b4','/api/line-hub')).status,403);
 assert.equal((await enterprise.api('pw-biz-b4','/api/commission-programs')).status,403);
});
