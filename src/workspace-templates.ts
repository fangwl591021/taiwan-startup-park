import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail,audit} from './shared.js';
import {platformAccess} from './platform.js';
import {body,text,version,role,json,requireModule} from './workspace-common.js';
export const builtinTemplates=[
 {id:'builtin-address-reply',name:'借址服務初次接洽',kind:'message',content:'您好，請問您的企業名稱、預計登記地區與開始使用日期？我們將確認適合的登記據點、合約期間與郵件代收方式，再提供正式報價。',status:'ready',operator_id:null,builtin:true},
 {id:'builtin-mail-reply',name:'郵件代收確認',kind:'message',content:'您好，您的收件紀錄已更新。請先確認領取方式與可領取時間；如需轉寄，運費與地址將另行確認。',status:'ready',operator_id:null,builtin:true},
 {id:'builtin-address-menu',name:'借址服務六格圖文選單',kind:'rich_menu',content:JSON.stringify([{label:'借址登記',message:'我想了解借址登記'},{label:'合約續租',message:'我想確認合約續租'},{label:'郵件代收',message:'查詢我的郵件代收'},{label:'帳務查詢',message:'我想確認帳務'},{label:'服務申請',message:'我要提出服務申請'},{label:'聯絡客服',message:'請服務人員聯絡我'}]),status:'ready',operator_id:null,builtin:true}
];
function content(kind:string,v:unknown){
 const s=text(v,'模板內容',4000);if(kind==='message')return s;
 let cells:any;try{cells=JSON.parse(s);}catch{fail(400,'圖文選單格式錯誤');}
 if(!Array.isArray(cells)||cells.length!==6||cells.some(c=>!c||typeof c!=='object'||Object.keys(c).some(k=>!['label','message'].includes(k))||typeof c.label!=='string'||!c.label.trim()||c.label.length>20||typeof c.message!=='string'||!c.message.trim()||c.message.length>300))fail(400,'圖文選單需填 6 格標題及文字訊息');
 return JSON.stringify(cells.map(c=>({label:c.label.trim(),message:c.message.trim()})));
}
export async function templateRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const url=new URL(req.url),system=url.pathname.startsWith('/api/platform/templates'),path=system?url.pathname.replace('/api/platform/templates','/api/templates'):url.pathname;
 if(!path.startsWith('/api/templates'))return null;
 if(system){if(!await platformAccess(env,a))fail(403,'僅系統總管理員可管理共用模板');}
 else {role(a,['operator_owner','operator_sales','operator_service']);await requireModule(env,a,'templates');}
 if(path==='/api/templates'&&req.method==='GET'){
  const q=(url.searchParams.get('q')||'').slice(0,100);
  const rows=(await stmt(env,'SELECT * FROM workspace_templates WHERE '+(system?'operator_id IS NULL':"(operator_id=? OR (operator_id IS NULL AND status='ready'))")+(system||a.role==='operator_owner'?'':" AND status='ready'")+' AND name LIKE ? ORDER BY updated_at DESC LIMIT 100',...(system?[]:[a.operator_id]),'%'+q+'%').all()).results;
  return json({items:[...builtinTemplates.filter(t=>t.name.includes(q)),...rows],line_publish_enabled:false,note:'回覆模板填入草稿後仍需人工確認。圖文選單目前為配置預覽，尚未上傳圖片或發布到 LINE。'});
 }
 const match=path.match(/^\/api\/templates(?:\/([^/]+))?$/);if(!match)fail(404,'找不到此模板操作');
 const id=match[1];if(!system)role(a,['operator_owner']);
 if(!['POST','PATCH'].includes(req.method)||id?.startsWith('builtin-'))fail(405,'內建模板可另存，不能覆寫');
 const d=await body(req,['name','kind','content','status','version']),name=text(d.name,'模板名稱',100),kind=String(d.kind),status=String(d.status);
 if(!['message','rich_menu'].includes(kind)||!['draft','ready'].includes(status))fail(400,'模板種類或狀態格式不正確');const value=content(kind,d.content),at=now(),tid=id||uid();
 const op=system?null:a.operator_id;
 if(id){
  const result=await env.DB.batch([
   stmt(env,'UPDATE workspace_templates SET name=?,kind=?,content=?,status=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND operator_id IS ? AND version=?',name,kind,value,status,a.id,at,id,op,version(d.version)),
   system?stmt(env,"INSERT INTO platform_activity(id,actor_id,action,detail,created_at) SELECT ?,?,'shared_template_updated',?,? WHERE changes()>0",uid(),a.id,JSON.stringify({template_id:id,name,kind}),at):audit(env,a,null,null,'template_updated',{template_id:id,name,kind},true)
  ]);
  if(!result[0].meta.changes)fail(409,'模板已更新或沒有修改權限');
 }else{
  await env.DB.batch([stmt(env,'INSERT INTO workspace_templates(id,operator_id,name,kind,content,status,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',tid,op,name,kind,value,status,a.id,at,at),
   system?stmt(env,"INSERT INTO platform_activity(id,actor_id,action,detail,created_at) VALUES(?,?,'shared_template_created',?,?)",uid(),a.id,JSON.stringify({template_id:tid,name,kind}),at):audit(env,a,null,null,'template_created',{template_id:tid,name,kind})]);
 }
 return json({id:tid,line_publish_enabled:false},id?200:201);
}
