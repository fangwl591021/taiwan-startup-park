import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail,digest,audit} from './shared.js';
import {json,body,text,version,role,businessScope,requireModule} from './workspace-common.js';
import {listPage} from './paging.js';
import {processInbox} from './line.js';
type Row=Record<string,any>;
function scope(a:Actor){
 role(a,['operator_owner','operator_sales','operator_service']);
 if(a.role==='operator_owner')return {sql:'p.operator_id=?',args:[a.operator_id]};
 const b=businessScope(a);
 return {sql:`p.operator_id=? AND ((p.business_id IS NOT NULL AND EXISTS(SELECT 1 FROM businesses b WHERE b.id=p.business_id AND ${b.sql}))${a.role==='operator_sales'?' OR (p.business_id IS NULL AND p.assigned_id=?)':''})`,args:[a.operator_id,...b.args,...(a.role==='operator_sales'?[a.id]:[])]};
}
async function person(env:Env,a:Actor,id:string){const s=scope(a);const p=await stmt(env,'SELECT p.* FROM crm_people p WHERE p.id=? AND '+s.sql,id,...s.args).first<Row>();if(!p)fail(404,'找不到可存取的會員');return p!;}
function projection(p:Row){return {...p,tags:JSON.parse(p.tags||'[]')};}
async function detail(env:Env,a:Actor,p:Row){
 const links=(await stmt(env,`SELECT l.line_contact_id,c.connection_id,n.name AS oa_name,n.provider_id,n.channel_id,c.conversation_id,
  (SELECT MAX(e.event_at) FROM line_events e WHERE e.connection_id=c.connection_id AND e.user_id=c.user_id) AS last_event_at
  FROM crm_line_links l JOIN line_contacts c ON c.id=l.line_contact_id AND c.operator_id=l.operator_id
  JOIN line_connections n ON n.id=c.connection_id AND n.operator_id=c.operator_id WHERE l.operator_id=? AND l.person_id=?`,a.operator_id,p.id).all()).results;
 const caseWhere=a.role==='operator_sales'?' AND o.owner_id=?':'';
 const cases=p.business_id?(await stmt(env,`SELECT o.id,o.title,o.stage,o.owner_id,o.followup_at,o.next_action,o.payment_status,o.updated_at,u.name AS owner_name
  FROM opportunities o JOIN staff_users u ON u.id=o.owner_id WHERE o.operator_id=? AND o.business_id=?${caseWhere} ORDER BY o.updated_at DESC LIMIT 50`,a.operator_id,p.business_id,...(a.role==='operator_sales'?[a.id]:[])).all()).results:[];
 const events=(await stmt(env,`SELECT ev.id,ev.action,ev.created_at,u.name AS actor_name FROM activity_events ev JOIN staff_users u ON u.id=ev.actor_id
  WHERE ev.operator_id=? AND (json_extract(ev.detail,'$.person_id')=?${p.business_id?' OR (ev.business_id=? AND (ev.opportunity_id IS NULL OR ev.opportunity_id IN(SELECT id FROM opportunities WHERE operator_id=?'+(a.role==='operator_sales'?' AND owner_id=?':'')+')))':''}) ORDER BY ev.created_at DESC,ev.id DESC LIMIT 50`,a.operator_id,p.id,...(p.business_id?[p.business_id,a.operator_id,...(a.role==='operator_sales'?[a.id]:[])]:[])).all()).results;
 return {...projection(p),links,cases,events,identity_note:'LINE 身分以 OA／Provider 為範圍；不依姓名、電話或 Email 自動合併。'};
}
export async function crmRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/crm'))return null;
 await requireModule(env,a,'crm');scope(a);
 if(path==='/api/crm/people'&&req.method==='GET'){
  const s=scope(a),q=(url.searchParams.get('q')||'').slice(0,100),tag=(url.searchParams.get('tag')||'').slice(0,40),status=url.searchParams.get('status')||'active';
  if(!['active','archived','all'].includes(status))fail(400,'會員狀態格式不正確');
  const where=s.sql+" AND (p.name LIKE ? OR p.company_name LIKE ? OR p.phone LIKE ?)"+(status==='all'?'':' AND p.status=?')+(tag?" AND EXISTS(SELECT 1 FROM json_each(p.tags) t WHERE t.value=?)":'');
  const result=await listPage(env,url,{select:`p.*,b.is_tenant,b.name AS business_name,u.name AS assigned_name,(SELECT COUNT(*) FROM crm_line_links l WHERE l.operator_id=p.operator_id AND l.person_id=p.id) AS line_count`,from:'crm_people p LEFT JOIN businesses b ON b.id=p.business_id AND b.operator_id=p.operator_id LEFT JOIN staff_users u ON u.id=p.assigned_id',where,args:[...s.args,'%'+q+'%','%'+q+'%','%'+q+'%',...(status==='all'?[]:[status]),...(tag?[tag]:[])],time:'p.updated_at',id:'p.id',timeKey:'updated_at'});
  return json({...result,items:result.items.map(projection)});
 }
 if(path==='/api/crm/people'&&req.method==='POST'){
  role(a,['operator_owner','operator_sales']);const d=await body(req,['name','company_name','phone','email','note']);
  const name=text(d.name,'姓名',100),company=text(d.company_name??'','公司名稱',150,true),phone=text(d.phone??'','電話',50,true),email=text(d.email??'','Email',200,true),note=text(d.note??'','備註',1000,true),id=uid(),at=now();
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Email 格式不正確');
  await env.DB.batch([stmt(env,"INSERT INTO crm_people(id,operator_id,assigned_id,name,company_name,phone,email,note,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'manual_crm',?,?)",id,a.operator_id,a.id,name,company,phone,email,note,at,at),audit(env,a,null,null,'crm_person_created',{person_id:id,source:'manual_crm'})]);
  return json({id},201);
 }
 const match=path.match(/^\/api\/crm\/people\/([^/]+)(?:\/(case|assign))?$/);if(!match)fail(404,'找不到此 CRM 操作');
 const p=await person(env,a,match[1]),action=match[2];
 if(req.method==='GET'&&!action)return json(await detail(env,a,p));
 if(req.method==='PATCH'&&!action){
  const d=await body(req,['name','company_name','phone','email','note','tags','status','version']);
  const v=version(d.version),name=text(d.name,'姓名',100),company=text(d.company_name,'公司名稱',150,true),phone=text(d.phone,'電話',50,true),email=text(d.email,'Email',200,true),note=text(d.note,'備註',1000,true);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Email 格式不正確');
  if(!Array.isArray(d.tags)||d.tags.length>12||d.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40))fail(400,'最多 12 個標籤，每個不超過 40 字');
  const tags=JSON.stringify([...new Set(d.tags.map(t=>(t as string).trim()))]);if(!['active','archived'].includes(String(d.status)))fail(400,'會員狀態格式不正確');
  const r=await env.DB.batch([
   stmt(env,'UPDATE crm_people SET name=?,company_name=?,phone=?,email=?,note=?,tags=?,status=?,version=version+1,updated_at=? WHERE operator_id=? AND id=? AND version=?',name,company,phone,email,note,tags,d.status,now(),a.operator_id,p.id,v),
   audit(env,a,p.business_id,null,'crm_profile_updated',{person_id:p.id,fields:['name','company_name','phone','email','note','tags','status']},true),
   stmt(env,'UPDATE contacts SET name=?,phone=?,email=? WHERE operator_id=? AND id=? AND changes()>0 AND EXISTS(SELECT 1 FROM crm_people WHERE operator_id=? AND id=? AND version=?)',name,phone,email,a.operator_id,p.contact_id,a.operator_id,p.id,v+1)
  ]);
  if(!r[0].meta.changes)fail(409,'會員已更新，請重新整理');return json({ok:true});
 }
 if(req.method==='PATCH'&&action==='assign'){
  role(a,['operator_owner']);if(p.business_id)fail(409,'已連結企業，請從成交案件或租戶管理指派承辦');
  const d=await body(req,['assigned_id','version']),id=text(d.assigned_id,'承辦人',100);
  if(!await stmt(env,"SELECT id FROM staff_users WHERE operator_id=? AND id=? AND active=1 AND role IN('operator_owner','operator_sales')",a.operator_id,id).first())fail(400,'承辦人不屬於本業者或已停權');
  const r=await env.DB.batch([stmt(env,'UPDATE crm_people SET assigned_id=?,version=version+1,updated_at=? WHERE operator_id=? AND id=? AND version=?',id,now(),a.operator_id,p.id,version(d.version)),audit(env,a,null,null,'crm_assignment_changed',{person_id:p.id,assigned_id:id},true)]);
  if(!r[0].meta.changes)fail(409,'會員已更新');return json({ok:true});
 }
 if(req.method==='POST'&&action==='case'){
  role(a,['operator_owner','operator_sales']);if(p.status!=='active')fail(409,'封存會員不能建立案件');
  const d=await body(req,['title','company_name','owner_id','amount','next_action','followup_at','version','request_key']);
  const v=version(d.version),title=text(d.title,'案件名稱',150),company=text(d.company_name,'企業名稱',150),key=text(d.request_key,'請求識別',100),next=text(d.next_action??'','下一步',500,true),follow=text(d.followup_at??'','跟進日期',40,true);
  if(follow&&!Number.isFinite(Date.parse(follow)))fail(400,'跟進日期不正確');
  if(!Number.isSafeInteger(d.amount)||Number(d.amount)<0||Number(d.amount)>1000000000)fail(400,'金額格式不正確');
  const owner=a.role==='operator_owner'?text(d.owner_id,'承辦人',100):a.id;
  if(a.role==='operator_sales'&&d.owner_id!==a.id)fail(403,'業務只能建立自己的案件');
  if(!await stmt(env,"SELECT id FROM staff_users WHERE operator_id=? AND id=? AND active=1 AND role IN('operator_owner','operator_sales')",a.operator_id,owner).first())fail(400,'案件負責人不可用');
  const hash=await digest(JSON.stringify({title,company,owner,amount:d.amount,next,follow}));
  const existing=await stmt(env,'SELECT * FROM crm_case_requests WHERE operator_id=? AND person_id=? AND request_key=?',a.operator_id,p.id,key).first<Row>();
  if(existing){if(existing.request_hash!==hash)fail(409,'此請求識別已用於不同內容');return json({id:existing.opportunity_id,business_id:existing.business_id,idempotent:true});}
  const bid=p.business_id||uid(),oid=uid(),cid=p.contact_id||uid(),convId=uid(),at=now();
  const unbound=(await stmt(env,'SELECT c.id,c.connection_id,c.user_id FROM crm_line_links l JOIN line_contacts c ON c.id=l.line_contact_id AND c.operator_id=l.operator_id WHERE l.operator_id=? AND l.person_id=? AND c.conversation_id IS NULL',a.operator_id,p.id).all<Row>()).results;
  const guard='EXISTS(SELECT 1 FROM crm_case_requests WHERE operator_id=? AND person_id=? AND request_key=? AND opportunity_id=?)',args=[a.operator_id,p.id,key,oid];
  const commands=[stmt(env,'INSERT OR IGNORE INTO crm_case_requests(operator_id,person_id,request_key,request_hash,opportunity_id,business_id,created_at) SELECT ?,?,?,?,?,?,? FROM crm_people WHERE operator_id=? AND id=? AND version=? AND status=\'active\'',a.operator_id,p.id,key,hash,oid,bid,at,a.operator_id,p.id,v)];
  if(!p.business_id)commands.push(stmt(env,'INSERT INTO businesses(id,operator_id,name,created_at) SELECT ?,?,?,? WHERE '+guard,bid,a.operator_id,company,at,...args));
  if(!p.contact_id){commands.push(stmt(env,'INSERT INTO contacts(id,operator_id,business_id,name,phone,email) SELECT ?,?,?,?,?,? WHERE '+guard,cid,a.operator_id,bid,p.name,p.phone,p.email,...args));commands.push(stmt(env,'DELETE FROM crm_people WHERE id=? AND operator_id=? AND '+guard,'crm-contact-'+cid,a.operator_id,...args));}
  commands.push(stmt(env,"INSERT INTO opportunities(id,operator_id,business_id,title,owner_id,source,amount,next_action,followup_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE "+guard,oid,a.operator_id,bid,title,owner,p.source==='line_webhook'?'LINE OA 來客':'CRM 會員',d.amount,next,follow,at,at,...args),
   stmt(env,'INSERT INTO conversations(id,operator_id,business_id,opportunity_id,created_at) SELECT ?,?,?,?,? WHERE '+guard,convId,a.operator_id,bid,oid,at,...args),
   stmt(env,'UPDATE crm_people SET business_id=?,contact_id=?,company_name=?,version=version+1,updated_at=? WHERE operator_id=? AND id=? AND version=? AND '+guard,bid,cid,company,at,a.operator_id,p.id,v,...args),
   audit(env,a,bid,oid,'crm_case_created',{person_id:p.id,source:p.source},true));
  if(unbound.length===1){const l=unbound[0];commands.push(
   stmt(env,'UPDATE line_contacts SET conversation_id=? WHERE operator_id=? AND id=? AND conversation_id IS NULL AND '+guard,convId,a.operator_id,l.id,...args),
   audit(env,a,bid,oid,'line_contact_linked',{contact_id:l.id,person_id:p.id,source:'crm_case'},true),
   stmt(env,"UPDATE line_events SET state='pending' WHERE operator_id=? AND connection_id=? AND user_id=? AND state='unmatched' AND EXISTS(SELECT 1 FROM line_contacts WHERE operator_id=? AND id=? AND conversation_id=?)",a.operator_id,l.connection_id,l.user_id,a.operator_id,l.id,convId));}
  const r=await env.DB.batch(commands);if(!r[0].meta.changes){
   const raced=await stmt(env,'SELECT opportunity_id,business_id,request_hash FROM crm_case_requests WHERE operator_id=? AND person_id=? AND request_key=?',a.operator_id,p.id,key).first<Row>();
   if(raced?.request_hash===hash)return json({id:raced.opportunity_id,business_id:raced.business_id,idempotent:true});
   fail(409,'會員已更新，請重新整理');
  }
  if(unbound.length===1)await processInbox(env,a.operator_id);
  return json({id:oid,business_id:bid,idempotent:false},201);
 }
 return fail(404,'找不到此 CRM 操作');
}
