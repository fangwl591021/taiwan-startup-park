import type {Actor,Env} from './types.js';
import {stmt,fail,now,audit} from './shared.js';
import {json,body,text,version,role,businessScope} from './workspace-common.js';
import {listPage} from './paging.js';

type Row=Record<string,unknown>;
export const sourceModuleCatalog=[
 {key:'CORE_MENU',name:'LINE 圖文選單'},
 {key:'CRM',name:'會員與客戶 CRM'},
 {key:'CAMPAIGN',name:'行銷活動'},
 {key:'COMMERCE',name:'商城與訂單'},
 {key:'TRAVEL',name:'旅遊與行程'},
 {key:'DEALER_COMMISSION',name:'經銷與佣金'},
 {key:'POINTS_REWARDS',name:'點數與獎勵'},
 {key:'AI',name:'AI 建議與執行'}
] as const;

// Recheck the current server record; cached actor objects are not capabilities.
async function currentActor(env:Env,a:Actor){
 const current=await stmt(env,'SELECT id,operator_id,name,role,active FROM staff_users WHERE id=? AND active=1',a.id).first<Actor>();
 if(!current||current.operator_id!==a.operator_id||current.role!==a.role)fail(401,'身分已變更，請重新登入');
 role(current,['operator_owner','operator_sales','operator_service','operator_finance','business_admin']);
 return current;
}
function workspaceScope(a:Actor){
 if(a.role==='business_admin')return {
  sql:"w.operator_id=? AND w.scope_kind='business' AND b.is_tenant=1 AND EXISTS(SELECT 1 FROM platform_business_members m WHERE m.operator_id=w.operator_id AND m.business_id=w.business_id AND m.user_id=? AND m.active=1)",
  args:[a.operator_id,a.id]
 };
 const b=businessScope(a);
 return {sql:"w.operator_id=? AND ("+(a.role==='operator_owner'?"w.scope_kind='operator' OR ":"")+"(w.scope_kind='business' AND b.is_tenant=1 AND "+b.sql+"))",args:[a.operator_id,...b.args]};
}
const from='platform_workspaces w JOIN operators o ON o.id=w.operator_id LEFT JOIN businesses b ON b.id=w.business_id AND b.operator_id=w.operator_id';
const select="w.*,CASE WHEN w.scope_kind='operator' THEN o.name ELSE b.name END AS name,b.is_tenant";
function projection(w:Row,a:Actor){
 // Viewing a borrowed-address customer never grants that company's retail CRM/OA.
 return {id:w.id,name:w.name,operator_id:w.operator_id,business_id:w.business_id,scope_kind:w.scope_kind,status:w.status,version:w.version,created_at:w.created_at,updated_at:w.updated_at,
  access:a.role==='business_admin'?'enterprise_membership':w.scope_kind==='operator'?'operator_owner':'borrowed_address_service',
  source_access:false,runtime_integrated:false,source_status:'pending_integration'};
}
async function workspace(env:Env,a:Actor,id:string){
 const scope=workspaceScope(a);
 const row=await stmt(env,'SELECT '+select+' FROM '+from+' WHERE w.id=? AND '+scope.sql,id,...scope.args).first<Row>();
 if(!row)fail(404,'找不到可存取的工作區');
 return row;
}
async function modules(env:Env,w:Row){
 const rows=(await stmt(env,'SELECT module,enabled,version FROM platform_workspace_entitlements WHERE operator_id=? AND workspace_id=?',w.operator_id,w.id).all()).results;
 if(rows.length!==sourceModuleCatalog.length||sourceModuleCatalog.some(c=>!rows.some(r=>r.module===c.key)))fail(503,'工作區權益尚未完整建立');
 return sourceModuleCatalog.map(c=>{const r=rows.find(r=>r.module===c.key)!;return {...c,enabled:false,configured_enabled:!!r.enabled,version:r.version,status:'pending_integration',price:null,revenue_share:null};});
}
async function addressSummary(env:Env,w:Row){
 if(w.scope_kind!=='business')return null;
 const business=await stmt(env,'SELECT id,name,registration_no,is_tenant FROM businesses WHERE operator_id=? AND id=?',w.operator_id,w.business_id).first();
 const contracts=(await stmt(env,'SELECT c.id,c.status,c.starts_on,c.ends_on,c.term_kind,c.payment_cycle,c.amount,c.version,l.name AS location_name FROM address_contracts c JOIN locations l ON l.operator_id=c.operator_id AND l.id=c.location_id WHERE c.operator_id=? AND c.business_id=? ORDER BY c.starts_on DESC,c.id DESC LIMIT 20',w.operator_id,w.business_id).all()).results;
 const requests=(await stmt(env,"SELECT module,status,created_at,updated_at FROM service_requests WHERE operator_id=? AND business_id=? AND status='requested' ORDER BY created_at DESC LIMIT 20",w.operator_id,w.business_id).all()).results;
 return {business,contracts,digital_requests:requests,phase:'address_only',digital_enabled:false,fees_agreed:false,price:null,revenue_share:null};
}

// Future in-process source adapter must use this result, never request role/workspace headers.
async function contextFromWorkspace(env:Env,a:Actor,w:Row){
 if(w.status!=='active')fail(409,'此工作區已暫停');
 return {workspace:projection(w,a),source_workspace_id:w.source_workspace_id,
  actor:{id:a.id,name:a.name,operator_id:a.operator_id,role:a.role},
  modules:await modules(env,w),source_role:null,source_access:false,runtime_integrated:false};
}
export async function platformWorkspaceContext(env:Env,actor:Actor,id:string){
 const a=await currentActor(env,actor);return contextFromWorkspace(env,a,await workspace(env,a,id));
}
export async function platformWorkspacesRoute(req:Request,env:Env,actor:Actor):Promise<Response|null>{
 const url=new URL(req.url),path=url.pathname;
 if(path!=='/api/platform-workspaces'&&!path.startsWith('/api/platform-workspaces/'))return null;
 const a=await currentActor(env,actor);
 if(path==='/api/platform-workspaces'&&req.method==='GET'){
  const s=workspaceScope(a),q=(url.searchParams.get('q')||'').slice(0,100);
  const page=await listPage(env,url,{select,from,where:s.sql+" AND (CASE WHEN w.scope_kind='operator' THEN o.name ELSE b.name END LIKE ?)",args:[...s.args,'%'+q+'%'],time:'w.updated_at',id:'w.id',timeKey:'updated_at'});
  return json({...page,items:page.items.map(w=>projection(w,a)),runtime_integrated:false});
 }
 const match=path.match(/^\/api\/platform-workspaces\/([^/]+)(?:\/(context|members)(?:\/([^/]+))?)?$/);
 if(!match)fail(404,'找不到工作區操作');
 const w=await workspace(env,a,match[1]);
 if(!match[2]&&req.method==='GET')return json({...projection(w,a),modules:await modules(env,w),address:await addressSummary(env,w),note:'原平台完整模組已保留；執行路由尚在整合，不代表已開通。'});
 if(match[2]==='context'&&!match[3]&&req.method==='GET')return json(await contextFromWorkspace(env,a,w));
 if(!match[2]&&req.method==='PATCH'){
  role(a,['operator_owner']);const d=await body(req,['status','version','reference']),v=version(d.version),reference=text(d.reference,'設定依據',500);
  if(!['active','suspended'].includes(String(d.status)))fail(400,'工作區狀態格式不正確');
  const result=await env.DB.batch([
   stmt(env,'UPDATE platform_workspaces SET status=?,version=version+1,updated_at=? WHERE id=? AND operator_id=? AND version=?',d.status,now(),w.id,a.operator_id,v),
   audit(env,a,w.business_id as string|null,null,'platform_workspace_status_changed',{workspace_id:w.id,from:w.status,to:d.status,reference},true)
  ]);
  if(!result[0].meta.changes)fail(409,'工作區已更新，請重新整理');
  return json({ok:true,workspace:projection((await workspace(env,a,match[1])),a)});
 }
 if(match[2]==='members'){
  role(a,['operator_owner']);if(w.scope_kind!=='business')fail(400,'企業管理員僅能加入企業工作區');
  if(!match[3]&&req.method==='GET')return json({items:(await stmt(env,'SELECT m.user_id,u.name,u.active AS user_active,m.active,m.version,m.created_at,m.updated_at FROM platform_business_members m JOIN staff_users u ON u.id=m.user_id AND u.operator_id=m.operator_id WHERE m.operator_id=? AND m.business_id=? ORDER BY m.created_at,m.user_id',a.operator_id,w.business_id).all()).results});
  if(match[3]&&req.method==='PUT'){
   const d=await body(req,['active','version','reference']),reference=text(d.reference,'授權依據',500);
   if(typeof d.active!=='boolean'||typeof d.version!=='number'||!Number.isSafeInteger(d.version)||d.version<0)fail(400,'授權或版本格式不正確');
   const user=await stmt(env,"SELECT id FROM staff_users WHERE id=? AND operator_id=? AND "+(d.active?"active=1 AND role='business_admin'":"EXISTS(SELECT 1 FROM platform_business_members m WHERE m.operator_id=staff_users.operator_id AND m.user_id=staff_users.id AND m.business_id=?)"),match[3],a.operator_id,...(d.active?[]:[w.business_id])).first();
   if(!user)fail(400,'請選擇本業者已驗證的有效企業管理帳號');
   const time=now(),statement=d.version===0?
    stmt(env,'INSERT INTO platform_business_members(operator_id,business_id,user_id,active,version,granted_by,created_at,updated_at) SELECT ?,?,?,?,1,?,?,? WHERE NOT EXISTS(SELECT 1 FROM platform_business_members WHERE operator_id=? AND business_id=? AND user_id=?)',a.operator_id,w.business_id,match[3],d.active?1:0,a.id,time,time,a.operator_id,w.business_id,match[3]):
    stmt(env,'UPDATE platform_business_members SET active=?,version=version+1,granted_by=?,updated_at=? WHERE operator_id=? AND business_id=? AND user_id=? AND version=?',d.active?1:0,a.id,time,a.operator_id,w.business_id,match[3],d.version);
   const result=await env.DB.batch([statement,audit(env,a,w.business_id as string,null,'platform_business_member_changed',{workspace_id:w.id,user_id:match[3],active:d.active,reference},true)]);
   if(!result[0].meta.changes)fail(409,'企業授權已更新，請重新整理');
   return json({ok:true,user_id:match[3],active:d.active,version:d.version+1});
  }
 }
 fail(404,'找不到工作區操作');
}
