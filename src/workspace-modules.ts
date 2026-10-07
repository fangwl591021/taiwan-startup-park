import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail} from './shared.js';
import {platformAccess} from './platform.js';
import {body,json,role,version} from './workspace-common.js';
export const moduleCatalog=[
 {key:'address',name:'借址登記',description:'成交追蹤、租戶、合約、帳務與郵件維運',core:true},
 {key:'crm',name:'會員 CRM',description:'LINE 來客、聯絡資料、標籤與案件歷程'},
 {key:'line_hub',name:'LINE OA 工作台',description:'接收狀態、Login 設定及來客關鍵字分類；需要 CRM'},
 {key:'templates',name:'模板中心',description:'共用／業者私有回覆與圖文選單草稿'},
 {key:'monitor',name:'聊天室核查',description:'管理員私有規則、待核查事件與核查歷程；AI 模型未啟用'},
 {key:'website',name:'企業官網',description:'後續數位租用，分潤待議定',future:true},
 {key:'store',name:'獨立商城',description:'後續數位租用，金流未串接',future:true},
 {key:'line_rental',name:'租戶 LINE OA／CRM',description:'租戶經營其顧客的付費服務，分潤待議定',future:true}
];
export async function moduleState(env:Env,operator:string){
 const rows=(await stmt(env,'SELECT module,enabled,version,updated_at FROM workspace_modules WHERE operator_id=?',operator).all()).results;
 return moduleCatalog.map(c=>{const r=rows.find(r=>r.module===c.key);return {...c,enabled:c.core===true||!!r?.enabled,version:Number(r?.version||1),updated_at:r?.updated_at||null,price:null,revenue_share:null};});
}
export async function moduleRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(path==='/api/workspace/modules'&&req.method==='GET'){role(a,['operator_owner','operator_sales','operator_service','operator_finance']);return json({modules:await moduleState(env,a.operator_id),fees_agreed:false,ai_enabled:false});}
 if(!path.startsWith('/api/platform/modules'))return null;
 if(!await platformAccess(env,a))fail(403,'僅系統總管理員可管理模組');
 if(path==='/api/platform/modules'&&req.method==='GET'){
  const operators=(await stmt(env,'SELECT id,name FROM operators ORDER BY id LIMIT 100').all()).results;
  return json({operators:await Promise.all(operators.map(async o=>({...o,modules:await moduleState(env,String(o.id))}))),fees_agreed:false,ai_enabled:false});
 }
 const match=path.match(/^\/api\/platform\/modules\/([^/]+)\/([^/]+)$/);
 if(match&&req.method==='PATCH'){
  const [_,op,key]=match,c=moduleCatalog.find(c=>c.key===key);if(!c)fail(400,'模組不存在');
  if(c.core||c.future)fail(409,c.core?'借址核心模組不能停用':'後續付費模組尚未開放啟用');
  const d=await body(req,['enabled','version','reference']);if(typeof d.enabled!=='boolean')fail(400,'開關格式不正確');
  const v=version(d.version),reference=typeof d.reference==='string'?d.reference.trim():'';if(!reference||reference.length>500)fail(400,'請填設定依據');
  const r=await env.DB.batch([
   stmt(env,`UPDATE workspace_modules SET enabled=?,version=version+1,updated_at=?,updated_by=? WHERE operator_id=? AND module=? AND version=?
    AND (?!='line_hub' OR ?=0 OR EXISTS(SELECT 1 FROM workspace_modules WHERE operator_id=? AND module='crm' AND enabled=1))
    AND (?!='crm' OR ?=1 OR NOT EXISTS(SELECT 1 FROM workspace_modules WHERE operator_id=? AND module='line_hub' AND enabled=1))`,d.enabled?1:0,now(),a.id,op,key,v,key,d.enabled?1:0,op,key,d.enabled?1:0,op),
   stmt(env,"INSERT INTO platform_activity(id,actor_id,action,detail,created_at) SELECT ?,?,'workspace_module_changed',?,? WHERE changes()>0",uid(),a.id,JSON.stringify({operator_id:op,module:key,enabled:d.enabled,reference}),now())
  ]);
  if(!r[0].meta.changes)fail(409,'設定已更新或相依模組不符；CRM 停用前請先停用 LINE OA 工作台');
  return json({ok:true,modules:await moduleState(env,op)});
 }
 fail(404,'找不到此模組操作');
}
