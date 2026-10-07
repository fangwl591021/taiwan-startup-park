import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/worker.js';
import {platformWorkspaceContext} from '../dist/platform-workspaces.js';
import {database,seed} from '../scripts/database.mjs';
async function fixture(t){
 const db=database();seed(db);t.after(()=>db.close());
 const env={DB:db,APP_ENV:'local',DEMO_MODE:'on',DIGITAL_PREVIEW:'off'};
 async function request(path,{method='GET',data,cookie='',headers={}}={}){
  const r=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{cookie,origin:'http://localhost','content-type':'application/json','x-requested-with':'tsp',...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 async function as(id){const r=await request('/demo/login',{method:'POST',data:{user_id:id}});assert.equal(r.status,200);return (path,method='GET',data,headers)=>request(path,{method,data,cookie:r.cookie,headers});}
 return {db,env,request,as};
}
test('workspace mapping is additive and preserves all existing customer and responder history',t=>{
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(directory).filter(p=>p.endsWith('.sql')&&p<'0015').sort())sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
 seed({sqlite});
 const tables=['operators','staff_users','businesses','contacts','opportunities','conversations','messages','address_contracts','ledger_entries','activity_events'];
 const snapshot=()=>Object.fromEntries(tables.map(name=>[name,sqlite.prepare('SELECT * FROM '+name).all()]));
 const before=snapshot();sqlite.exec(readFileSync(new URL('0015_platform_workspace_bridge.sql',directory),'utf8'));assert.deepEqual(snapshot(),before);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM platform_workspaces WHERE scope_kind='operator'").get().n,2);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM platform_workspaces WHERE scope_kind='business'").get().n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM platform_workspace_entitlements').get().n,24);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM platform_workspace_entitlements WHERE enabled=1').get().n,0);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM platform_workspaces WHERE source_workspace_id='default'").get().n,0);
});
test('each operator and won business has one immutable mapping and eight explicit disabled source grants',async t=>{
 const {db,as}=await fixture(t);const a=await as('owner-a');
 assert.deepEqual((await a('/platform-workspaces')).data.items.map(w=>w.id).sort(),['pw-biz-b4','pw-op-op-a']);
 const detail=(await a('/platform-workspaces/pw-biz-b4')).data;
 assert.equal(detail.modules.length,8);assert(detail.modules.every(m=>m.enabled===false&&m.configured_enabled===false&&m.revenue_share===null&&m.price===null));
 assert.equal(detail.runtime_integrated,false);assert.equal(detail.source_access,false);
 assert.equal(detail.address.business.id,'b4');assert.equal(detail.address.contracts[0].starts_on,'2026-10-01');assert.equal(detail.address.contracts[0].ends_on,'2027-09-30');
 assert.throws(()=>db.sqlite.prepare("UPDATE platform_workspaces SET business_id='b1' WHERE id='pw-biz-b4'").run(),/immutable/);
 assert.throws(()=>db.sqlite.prepare("UPDATE platform_workspaces SET source_workspace_id='default' WHERE id='pw-op-op-a'").run(),/immutable/);
});
test('conversion, duplicate win and a new add-on case reuse the same enterprise workspace without enabling digital services',async t=>{
 const {db,as}=await fixture(t);const a=await as('owner-a');
 assert.equal((await a('/platform-workspaces/pw-biz-b3')).status,404);
 assert.equal((await a('/opportunities/o3/win','POST',{version:1})).status,200);
 assert.equal((await a('/opportunities/o3/win','POST',{version:1})).status,200);
 const add=await a('/opportunities','POST',{business_id:'b3',title:'同企業新服務',amount:12000,owner_id:'sales-a2'});assert.equal(add.status,201);
 let o=(await a('/opportunities/'+add.data.id)).data;
 assert.equal((await a('/opportunities/'+add.data.id,'PATCH',{version:o.version,stage:'onboarding'})).status,200);
 o=(await a('/opportunities/'+add.data.id)).data;
 assert.equal((await a('/opportunities/'+add.data.id,'PATCH',{version:o.version,stage:'billing'})).status,200);
 o=(await a('/opportunities/'+add.data.id)).data;
 assert.equal((await a('/opportunities/'+add.data.id+'/win','POST',{version:o.version})).status,200);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_workspaces WHERE business_id='b3'").get().n,1);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_workspace_entitlements WHERE workspace_id='pw-biz-b3'").get().n,8);
 assert.equal((await a('/platform-workspaces/pw-biz-b3/context')).data.source_access,false);
});
test('new operator and direct tenant creation establish isolated workspaces automatically',async t=>{
 const {db,as}=await fixture(t);const a=await as('owner-a');
 db.sqlite.prepare("INSERT INTO operators(id,name) VALUES('op-new','新業者')").run();
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_workspace_entitlements WHERE workspace_id='pw-op-op-new'").get().n,8);
 const created=await a('/tenants','POST',{business_name:'工作區測試企業',contact_name:'測試窗口',reference:'TEST ONLY existing tenant'});
 assert.equal(created.status,201);const detail=await a('/platform-workspaces/pw-biz-'+created.data.business_id);assert.equal(detail.status,200);assert.equal(detail.data.address.business.id,created.data.business_id);
});
test('cross-operator IDs, forged role/workspace headers and source paths never expand permissions',async t=>{
 const {as}=await fixture(t);const a=await as('owner-a'),b=await as('owner-b'),sales=await as('sales-a1');
 assert.equal((await a('/platform-workspaces/pw-op-op-b')).status,404);
 assert.equal((await b('/platform-workspaces/pw-biz-b4')).status,404);
 const forged={'X-Workspace-Id':'pw-op-op-a','X-Actor-Id':'owner-a','X-User-Role':'owner','Authorization':'Bearer forged'};
 assert.equal((await sales('/platform-workspaces/pw-op-op-a','GET',undefined,forged)).status,404);
 assert.equal((await sales('/platform-workspaces/pw-biz-b4/context','GET',undefined,forged)).status,404);
 assert.equal((await a('/platform-workspaces/pw-op-op-a/source/api/system/workspaces')).status,404);
 assert.equal((await a('/platform-workspaces/pw-op-op-b','PATCH',{status:'suspended',version:1,reference:'forged'})).status,404);
});
test('sales and service scopes follow current assignments and never grant upstream operator-owner access',async t=>{
 const {db,as}=await fixture(t);const sales=await as('sales-a1'),service=await as('service-a'),finance=await as('finance-a');
 assert.deepEqual((await sales('/platform-workspaces')).data.items,[]);
 assert.deepEqual((await service('/platform-workspaces')).data.items.map(w=>w.id),['pw-biz-b4']);
 assert.equal((await finance('/platform-workspaces/pw-op-op-a')).status,404);
 db.sqlite.prepare("UPDATE businesses SET service_owner_id='sales-a1' WHERE id='b4'").run();
 const context=await sales('/platform-workspaces/pw-biz-b4/context');assert.equal(context.status,200);assert.equal(context.data.source_role,null);assert.equal(context.data.actor.id,'sales-a1');
 assert.equal((await service('/platform-workspaces/pw-biz-b4/context')).status,404);
});
test('platform admin and uninvited enterprise user receive no workspace/customer/monitor payload',async t=>{
 const {as}=await fixture(t);
 const platform=await as('platform');assert.equal((await platform('/platform-workspaces')).status,403);
 const business=await as('business-admin');assert.deepEqual((await business('/platform-workspaces')).data.items,[]);
 assert.equal((await business('/platform-workspaces/pw-biz-b4')).status,404);
 for(const user of [business,platform])for(const path of ['/admin/monitor','admin/monitor-console','/conversations'])assert([403,404].includes((await user(path.startsWith('/')?path:'/'+path)).status));
});
test('enterprise membership is explicit, versioned, revocable and limited to the granted business',async t=>{
 const {as,db}=await fixture(t);const owner=await as('owner-a'),business=await as('business-admin');
 const grant=()=>owner('/platform-workspaces/pw-biz-b4/members/business-admin','PUT',{active:true,version:0,reference:'TEST ONLY customer authorization'});
 assert.equal((await grant()).status,200);assert.equal((await grant()).status,409);
 assert.deepEqual((await business('/platform-workspaces')).data.items.map(w=>w.id),['pw-biz-b4']);
 const context=(await business('/platform-workspaces/pw-biz-b4/context')).data;assert.equal(context.actor.id,'business-admin');assert.equal(context.workspace.access,'enterprise_membership');assert.equal(context.source_role,null);
 assert.equal((await business('/platform-workspaces/pw-op-op-a')).status,404);
 assert.equal((await business('/platform-workspaces/pw-biz-b4/members')).status,403);
 assert.equal((await business('/platform-workspaces/pw-biz-b4','PATCH',{status:'suspended',version:1,reference:'not owner'})).status,403);
 db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='business-admin'").run();
 const revoke=await owner('/platform-workspaces/pw-biz-b4/members/business-admin','PUT',{active:false,version:1,reference:'TEST ONLY revoked consent'});assert.equal(revoke.status,200);
 assert.equal((await business('/platform-workspaces/pw-biz-b4/context')).status,401);
 db.sqlite.prepare("UPDATE staff_users SET active=1 WHERE id='business-admin'").run();
 assert.equal((await business('/platform-workspaces/pw-biz-b4/context')).status,404);
 const events=db.sqlite.prepare("SELECT actor_id,detail FROM activity_events WHERE action='platform_business_member_changed'").all();assert.equal(events.length,2);assert(events.every(e=>e.actor_id==='owner-a'));
});
test('membership cannot assign foreign staff, sales, stopped or client-forged actors',async t=>{
 const {as,db}=await fixture(t);const owner=await as('owner-a');
 for(const id of ['sales-b','sales-a1','owner-a'])assert.equal((await owner('/platform-workspaces/pw-biz-b4/members/'+id,'PUT',{active:true,version:0,reference:'invalid role'})).status,400);
 db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='business-admin'").run();
 assert.equal((await owner('/platform-workspaces/pw-biz-b4/members/business-admin','PUT',{active:true,version:0,reference:'inactive'})).status,400);
 assert.equal((await owner('/platform-workspaces/pw-biz-b4','PATCH',{status:'suspended',version:1,reference:'forged',actor_id:'sales-b'})).status,400);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_business_members').get().n,0);
});
test('suspension and optimistic version gate source context while borrowed contracts and actor history remain intact',async t=>{
 const {db,as}=await fixture(t);const owner=await as('owner-a');
 const before=db.sqlite.prepare('SELECT * FROM address_contracts').all();
 assert.equal((await owner('/platform-workspaces/pw-biz-b4','PATCH',{status:'suspended',version:1,reference:'TEST ONLY suspended'})).status,200);
 assert.equal((await owner('/platform-workspaces/pw-biz-b4/context')).status,409);
 assert.equal((await owner('/platform-workspaces/pw-biz-b4','PATCH',{status:'active',version:1,reference:'stale'})).status,409);
 assert.equal((await owner('/platform-workspaces/pw-biz-b4','PATCH',{status:'active',version:2,reference:'TEST ONLY resumed'})).status,200);
 assert.equal((await owner('/platform-workspaces/pw-biz-b4/context')).status,200);
 assert.deepEqual(db.sqlite.prepare('SELECT * FROM address_contracts').all(),before);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='platform_workspace_status_changed'").get().n,2);
});
test('stopped sessions and stale/forged internal actor contexts fail closed',async t=>{
 const {db,env,as}=await fixture(t);const owner=await as('owner-a');
 const actor={id:'owner-a',operator_id:'op-a',name:'ignored',role:'operator_owner',active:1};
 assert.equal((await platformWorkspaceContext(env,actor,'pw-biz-b4')).actor.name,'管理員 · 林園長');
 await assert.rejects(platformWorkspaceContext(env,{...actor,operator_id:'op-b'},'pw-biz-b4'),e=>e.status===401);
 db.sqlite.prepare("UPDATE staff_users SET active=0 WHERE id='owner-a'").run();
 assert.equal((await owner('/platform-workspaces')).status,401);
 await assert.rejects(platformWorkspaceContext(env,actor,'pw-biz-b4'),e=>e.status===401);
});
test('list cursor/search are bounded, do not leak hidden workspaces, and missing grants never inherit legacy defaults',async t=>{
 const {db,as}=await fixture(t);const owner=await as('owner-a');
 let r=await owner('/platform-workspaces?limit=1');assert.equal(r.data.items.length,1);assert.equal(r.data.total,2);assert.equal(r.data.has_more,true);
 const next=await owner('/platform-workspaces?limit=1&cursor='+encodeURIComponent(r.data.next_cursor));assert.equal(next.data.items.length,1);assert.notEqual(next.data.items[0].id,r.data.items[0].id);
 assert.equal((await owner('/platform-workspaces?limit=101')).status,400);assert.equal((await owner('/platform-workspaces?cursor=bad')).status,400);
 assert.deepEqual((await owner('/platform-workspaces?q='+encodeURIComponent('晴川'))).data.items,[]);
 db.sqlite.prepare("DELETE FROM platform_workspace_entitlements WHERE workspace_id='pw-biz-b4' AND module='AI'").run();
 assert.equal((await owner('/platform-workspaces/pw-biz-b4/context')).status,503);
});
test('write endpoints retain same-origin and JSON field-whitelist protection',async t=>{
 const {as}=await fixture(t);const owner=await as('owner-a');
 assert.equal((await owner('/platform-workspaces/pw-biz-b4','PATCH',{status:'suspended',version:1,reference:'CSRF'},{origin:'https://attacker.invalid'})).status,403);
 for(const extra of [{operator_id:'op-b'},{role:'operator_owner'},{source_workspace_id:'default'},{enabled:true}]){
  assert.equal((await owner('/platform-workspaces/pw-biz-b4','PATCH',{status:'suspended',version:1,reference:'forged',...extra})).status,400);
 }
});
