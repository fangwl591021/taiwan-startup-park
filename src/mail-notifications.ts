import type {Actor,Env} from './types.js';
import {stmt,fail,now,uid,audit} from './shared.js';
type Row=Record<string,any>;
const roles=['operator_owner','operator_sales','operator_service'];
const json=(data:unknown,status=200)=>Response.json(data,{status});
const allowed=(a:Actor)=>{if(!roles.includes(a.role))fail(403,'沒有此操作權限');};
const owner=(a:Actor)=>{if(a.role!=='operator_owner')fail(403,'只有管理員可確認通知聯絡人');};
const field=(v:unknown,label:string,max=300)=>{if(typeof v!=='string'||!v.trim()||v.length>max)return fail(400,label+'格式不正確');return v.trim();};
function version(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)fail(400,'版本格式不正確');return v as number;}
async function body(req:Request){
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>8000)fail(413,'內容過長');
 let d:Row;try{d=JSON.parse(raw);}catch{return fail(400,'JSON 格式錯誤');}
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['action','version','line_contact_id','recipient_name','reference'].includes(k)))fail(400,'包含不允許的欄位');
 return d;
}
const observed="EXISTS(SELECT 1 FROM line_events e WHERE e.operator_id=c.operator_id AND e.connection_id=c.connection_id AND e.user_id=c.user_id AND e.kind IN('message','follow'))";
const validUser="length(c.user_id)=33 AND substr(c.user_id,1,1)='U' AND substr(c.user_id,2) NOT GLOB '*[^0-9a-f]*'";
function hint(user:string){return user.slice(0,5)+'…'+user.slice(-4);}
async function saved(env:Env,a:Actor,biz:string){
 return stmt(env,'SELECT r.*,c.connection_id,c.user_id,l.enabled FROM tenant_mail_line_recipients r LEFT JOIN line_contacts c ON c.id=r.line_contact_id AND c.operator_id=r.operator_id LEFT JOIN line_connections l ON l.id=c.connection_id AND l.operator_id=r.operator_id WHERE r.operator_id=? AND r.business_id=?',a.operator_id,biz).first<Row>();
}
export async function mailLineState(env:Env,a:Actor,biz:string){
 allowed(a);const r=await saved(env,a,biz),linked=!!r&&r.status==='linked';
 return {status:linked?'linked':'unbound',version:r?.version??0,send_status:'not_enabled',preparation_only:true,
  recipient:linked?{name:r.recipient_name,connection_id:r.connection_id,identity_hint:hint(r.user_id),channel_enabled:!!r.enabled,...(a.role==='operator_owner'?{line_contact_id:r.line_contact_id,reference:r.reference}:{})}:null};
}
export async function mailLineRoute(req:Request,env:Env,a:Actor,b:Row,kind:string,id?:string){
 allowed(a);if(!b.is_tenant)fail(409,'請先建立租戶');
 const url=new URL(req.url),method=req.method,biz=String(b.id);
 if(kind==='mail-line'&&id==='candidates'&&method==='GET'){
  owner(a);const q=(url.searchParams.get('q')||'').trim();if(q.length>100)fail(400,'搜尋文字過長');
  const items=(await stmt(env,"SELECT c.id,c.connection_id,c.user_id,b.name AS business_name,(SELECT substr(e.body,1,120) FROM line_events e WHERE e.operator_id=c.operator_id AND e.connection_id=c.connection_id AND e.user_id=c.user_id AND e.kind='message' ORDER BY e.event_at DESC,e.event_id DESC LIMIT 1) AS preview FROM line_contacts c JOIN line_connections l ON l.id=c.connection_id AND l.operator_id=c.operator_id LEFT JOIN conversations v ON v.id=c.conversation_id AND v.operator_id=c.operator_id LEFT JOIN businesses b ON b.id=v.business_id AND b.operator_id=c.operator_id WHERE c.operator_id=? AND "+validUser+' AND '+observed+" AND (c.id LIKE ? OR c.connection_id LIKE ? OR COALESCE(b.name,'') LIKE ?) ORDER BY CASE WHEN v.business_id=? THEN 0 ELSE 1 END,c.created_at DESC,c.id DESC LIMIT 50",a.operator_id,'%'+q+'%','%'+q+'%','%'+q+'%',biz).all<Row>()).results;
  return json({items:items.map(({user_id,...r})=>({...r,identity_hint:hint(user_id)})),limit:50});
 }
 if(kind==='mail-line'&&!id&&method==='GET')return json(await mailLineState(env,a,biz));
 if(kind==='mail-line'&&!id&&method==='POST'){
  owner(a);const d=await body(req),v=version(d.version),reference=field(d.reference,'綁定／解除依據',500),current=await saved(env,a,biz);
  if(v!==(current?.version??0))fail(409,'通知聯絡人已異動，請重新整理');
  const action=d.action??'link';if(!['link','unlink'].includes(action))fail(400,'操作不正確');
  if(action==='unlink'){
   if(!current||current.status!=='linked')fail(409,'目前沒有已綁定通知聯絡人');
   if(d.line_contact_id!==undefined||d.recipient_name!==undefined)fail(400,'解除綁定不需指定新收件人');
   const result=await env.DB.batch([
    stmt(env,"UPDATE tenant_mail_line_recipients SET status='unlinked',line_contact_id=NULL,recipient_name='',reference=?,actor_id=?,version=version+1,updated_at=? WHERE operator_id=? AND business_id=? AND version=?",reference,a.id,now(),a.operator_id,biz,v),
    audit(env,a,biz,null,'mail_line_recipient_unlinked',{previous_contact_id:current.line_contact_id,reference},true)
   ]);
   if(!result[0].meta.changes)fail(409,'通知聯絡人已異動，請重新整理');
   return json(await mailLineState(env,a,biz));
  }
  const contactId=field(d.line_contact_id,'LINE 來客',100),name=field(d.recipient_name,'通知聯絡人姓名',100);
  const c=await stmt(env,'SELECT c.id FROM line_contacts c JOIN line_connections l ON l.id=c.connection_id AND l.operator_id=c.operator_id WHERE c.id=? AND c.operator_id=? AND '+validUser+' AND '+observed,contactId,a.operator_id).first();
  if(!c)fail(400,'請選擇本業者已驗簽接收的 LINE 來客；不能手填 LINE ID');
  const write=current?stmt(env,"UPDATE tenant_mail_line_recipients SET status='linked',line_contact_id=?,recipient_name=?,reference=?,actor_id=?,version=version+1,updated_at=? WHERE operator_id=? AND business_id=? AND version=?",contactId,name,reference,a.id,now(),a.operator_id,biz,v):
   stmt(env,"INSERT OR IGNORE INTO tenant_mail_line_recipients(id,operator_id,business_id,line_contact_id,recipient_name,reference,status,actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'linked',?,?,?)",uid(),a.operator_id,biz,contactId,name,reference,a.id,now(),now());
  const result=await env.DB.batch([write,audit(env,a,biz,null,'mail_line_recipient_linked',{contact_id:contactId,previous_contact_id:current?.line_contact_id??null,recipient_name:name,reference,send_status:'not_enabled'},true)]);
  if(!result[0].meta.changes)fail(409,'通知聯絡人已異動，請重新整理');
  return json(await mailLineState(env,a,biz));
 }
 if(kind==='mail-preview'&&id&&method==='GET'){
  const m=await stmt(env,'SELECT id,kind,description,status,created_at,version FROM mail_items WHERE id=? AND operator_id=? AND business_id=?',id,a.operator_id,biz).first<Row>();if(!m)fail(404,'找不到可存取的收件');
  const binding=await mailLineState(env,a,biz);
  const text=b.name+' 您好：\n您有一件'+(m.kind==='package'?'包裹':'信件')+'已由業者代收。\n收件摘要：'+m.description+'\n收件時間：'+new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(m.created_at))+'\n請聯絡服務承辦人確認領取或轉寄安排。';
  return json({status:'preview_only',sent:false,text,binding,mail_status:m.status,mail_version:m.version,notice:['collected','forwarded','returned'].includes(m.status)?'此件已交付或退回，僅供預覽歷史內容':binding.status==='unbound'?'尚未綁定通知聯絡人':'通知推播尚未啟用，沒有發送訊息'});
 }
 return fail(404,'找不到此通知操作');
}
