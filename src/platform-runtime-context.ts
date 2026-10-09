import type {Actor,Env} from './types.js';
import {platformWorkspaceContext} from './platform-workspaces.js';
import {fail,stmt} from './shared.js';
export async function runtimeContext(env:Env,a:Actor,id:string){
 const c=await platformWorkspaceContext(env,a,id);
 // Borrowed-address assignment is deliberately not retail workspace ownership.
 if(!((c.workspace.scope_kind==='operator'&&a.role==='operator_owner')||(c.workspace.scope_kind==='business'&&a.role==='business_admin')))fail(403,'企業數位工作區需要企業管理帳號明確授權');
 if(env.PLATFORM_RUNTIME_ENABLED!=='on')fail(503,'完整數位工作區尚未啟用');
 const rows=(await stmt(env,'SELECT module,enabled,version FROM platform_workspace_entitlements WHERE operator_id=? AND workspace_id=?',a.operator_id,id).all()).results;
 if(!rows.some(r=>r.enabled===1))fail(409,'此企業數位功能尚未開通，費率及分潤待議定');
 return {...c,source_role:'owner',source_access:true,runtime_integrated:true,
  modules:c.modules.map(m=>({...m,enabled:rows.find(r=>r.module===m.key)?.enabled===1,status:rows.find(r=>r.module===m.key)?.enabled===1?'available':'not_enabled'}))};
}
