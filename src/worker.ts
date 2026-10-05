import type {Actor,Env,Opportunity,Statement} from './types.js';
import {HttpError,fail,now,uid,stmt,local,sandbox,demo,digest,audit} from './shared.js';
import {actor,accessLogin,configured,sandboxAccess} from './auth.js';
import {receiveWebhook,processInbox,integrationStatus,inbox,attachContact,enqueueLine,dispatchOutbox,retryLine,conversationLineStatus} from './line.js';
import {operationRoute} from './operations.js';
type Context={waitUntil(promise:Promise<unknown>):void};
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers});
const stages=['contact','onboarding','billing','won','paused','lost'];
const modules=['website','store','line','crm'];
function textField(v:unknown,label:string,max=300,empty=false):string{
 if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))return fail(400,label+'格式不正確');
 return v.trim();
}
function numberField(v:unknown,label:string,max=1000000000):number{
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)return fail(400,label+'格式不正確');
 return v;
}
async function body(req:Request,keys:string[]):Promise<Record<string,unknown>>{
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text(); if(raw.length>16000)fail(413,'內容過長');
 let data:unknown;try{data=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}
 if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'請提供物件');
 const d=data as Record<string,unknown>;
 if(Object.keys(d).some(k=>!keys.includes(k)))fail(400,'包含不允許的欄位');
 return d;
}
function writes(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin||req.headers.get('x-requested-with')!=='tsp')fail(403,'請從工作台操作');
}
function roles(a:Actor,allowed:string[]){if(!allowed.includes(a.role))fail(403,'沒有此操作權限');}
function opScope(a:Actor,alias='o'):{sql:string,args:unknown[]}{
 roles(a,['operator_owner','operator_sales','operator_finance']);
 return a.role==='operator_sales'?{sql:alias+'.operator_id=? AND '+alias+'.owner_id=?',args:[a.operator_id,a.id]}:{sql:alias+'.operator_id=?',args:[a.operator_id]};
}
function bizScope(a:Actor,alias='b'):{sql:string,args:unknown[]}{
 roles(a,['operator_owner','operator_sales','operator_service','operator_finance']);
 if(a.role==='operator_sales')return {sql:alias+'.operator_id=? AND (EXISTS(SELECT 1 FROM opportunities ao WHERE ao.operator_id='+alias+'.operator_id AND ao.business_id='+alias+'.id AND ao.owner_id=?) OR ('+alias+'.is_tenant=1 AND '+alias+'.service_owner_id=?))',args:[a.operator_id,a.id,a.id]};
 if(a.role==='operator_service')return {sql:alias+'.operator_id=? AND '+alias+'.is_tenant=1 AND '+alias+'.service_owner_id=?',args:[a.operator_id,a.id]};
 return {sql:alias+'.operator_id=?',args:[a.operator_id]};
}
async function getOpportunity(env:Env,a:Actor,id:string){
 const s=opScope(a);
 const o=await stmt(env,'SELECT o.* FROM opportunities o WHERE o.id=? AND '+s.sql,id,...s.args).first<Opportunity>();
 if(!o)fail(404,'找不到可存取的案件'); return o!;
}
async function getBusiness(env:Env,a:Actor,id:string){
 const s=bizScope(a);
 const b=await stmt(env,'SELECT b.* FROM businesses b WHERE b.id=? AND '+s.sql,id,...s.args).first();
 if(!b)fail(404,'找不到可存取的企業');return b!;
}
async function getConversation(env:Env,a:Actor,id:string){
 roles(a,['operator_owner','operator_sales','operator_service']);
 const s=bizScope(a);
 const c=await stmt(env,'SELECT c.*,o.owner_id,o.title FROM conversations c JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id JOIN opportunities o ON o.id=c.opportunity_id AND o.operator_id=c.operator_id WHERE c.id=? AND c.operator_id=? AND '+s.sql,id,a.operator_id,...s.args).first();
 if(!c||(a.role==='operator_sales'&&c.owner_id!==a.id))fail(404,'找不到可存取的對話');return c!;
}
async function agent(env:Env,a:Actor,id:unknown){
 const value=textField(id,'承辦人',100);
 const u=await stmt(env,"SELECT id FROM staff_users WHERE id=? AND operator_id=? AND active=1 AND role IN('operator_owner','operator_sales')",value,a.operator_id).first();
 if(!u)fail(400,'承辦人不屬於本業者或已停權');return value;
}
async function route(req:Request,env:Env,ctx?:Context):Promise<Response>{
 const url=new URL(req.url);const path=url.pathname;const method=req.method;
 if(env.APP_ENV==='sandbox'){
  if(!sandbox(req,env))fail(503,'測試環境隔離檢查未通過');
  if(path.startsWith('/api/'))await sandboxAccess(req,env);
 }
 if(path==='/api/health')return json({ok:true,version:'0.3.0'});
 if(path==='/api/bootstrap'&&method==='GET')return json({demo:demo(req,env),sandbox:sandbox(req,env),auth:demo(req,env)?'local_demo':configured(env)?'cloudflare_access':'not_configured',integrations:{line:'not_connected',payment:'not_connected',ai:'not_enabled'}});
 const webhook=path.match(/^\/api\/line\/webhook\/([a-zA-Z0-9_-]+)$/);
 if(webhook&&method==='POST'){
  if(sandbox(req,env))fail(404,'測試環境不接收真實 LINE');
  const response=await receiveWebhook(req,env,webhook[1]);
  ctx?.waitUntil(processInbox(env).catch(()=>console.error('LINE inbox processing needs recovery')));
  return response;
 }
 if(!path.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(req):new Response('Not found',{status:404});
 if(!['GET','HEAD','OPTIONS'].includes(method))writes(req);
 if(path==='/api/demo/users'&&method==='GET'){
  if(!demo(req,env))fail(404,'不存在');
  const users=(await stmt(env,'SELECT u.id,u.name,u.role,o.name AS operator_name FROM staff_users u JOIN operators o ON o.id=u.operator_id WHERE u.active=1 ORDER BY u.operator_id,u.id').all()).results;
  return json(sandbox(req,env)?users.filter(u=>['operator_owner','operator_sales','operator_service','operator_finance'].includes(String(u.role))):users);
 }
 if(path==='/api/demo/login'&&method==='POST'){
  if(!demo(req,env))fail(404,'不存在');
  const d=await body(req,['user_id']);const id=textField(d.user_id,'使用者',100);
  const u=await stmt(env,'SELECT id,role FROM staff_users WHERE id=? AND active=1',id).first();
  if(!u||sandbox(req,env)&&!['operator_owner','operator_sales','operator_service','operator_finance'].includes(String(u.role)))fail(401,'帳號不可使用');
  const token=uid()+uid();
  const claim=sandbox(req,env)?await sandboxAccess(req,env):null;
  const seconds=claim?Math.max(0,Math.min(28800,claim.exp-Math.floor(Date.now()/1000))):28800;
  await stmt(env,"INSERT INTO sessions(token_hash,user_id,expires_at,auth_method,issuer,subject) VALUES(?,?,?,'demo',?,?)",await digest(token),id,new Date(Date.now()+seconds*1000).toISOString(),claim?.iss??null,claim?.sub??null).run();
  return json({ok:true},200,{'Set-Cookie':'tsp_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+seconds+(sandbox(req,env)?'; Secure':'')});
 }
 if(path==='/api/auth/access'&&method==='POST'){if(sandbox(req,env))fail(404,'請選擇模擬帳號');await body(req,[]);return accessLogin(req,env);}
 const a=await actor(req,env);
 const operation=await operationRoute(req,env,a,id=>getBusiness(env,a,id));if(operation)return operation;
 if(path==='/api/integrations'&&method==='GET')return json(await integrationStatus(env,a));
 if(path==='/api/line/inbox'&&method==='GET')return json(await inbox(env,a));
 const attach=path.match(/^\/api\/line\/inbox\/([^/]+)\/attach$/);
 if(attach&&method==='POST'){const d=await body(req,['conversation_id']);return json(await attachContact(env,a,attach[1],textField(d.conversation_id,'對話',100)));}
 if(path==='/api/line/recover'&&method==='POST'){
  roles(a,['operator_owner']);await body(req,[]);
  const received=await processInbox(env,a.operator_id);
  const sent=await dispatchOutbox(env,a.operator_id);
  return json({received,...sent});
 }
 const lineStatus=path.match(/^\/api\/conversations\/([^/]+)\/line-status$/);
 if(lineStatus&&method==='GET'){await getConversation(env,a,lineStatus[1]);return json(await conversationLineStatus(env,a,lineStatus[1]));}

 if(path==='/api/me'&&method==='GET'){
  const op=await stmt(env,'SELECT name FROM operators WHERE id=?',a.operator_id).first();
  return json({...a,operator_name:op?.name,demo:demo(req,env),sandbox:sandbox(req,env)});
 }
 if(path==='/api/logout'&&method==='POST'){
  const token=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('tsp_session='))?.slice(12)||'';
  await stmt(env,'DELETE FROM sessions WHERE token_hash=?',await digest(token)).run();
  return json({ok:true},200,{'Set-Cookie':'tsp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(local(req,env)?'':'; Secure')});
 }
 if(path==='/api/staff'&&method==='GET'){
  roles(a,['operator_owner','operator_sales','operator_service','operator_finance']);
  return json((await stmt(env,"SELECT u.id,u.name,u.role,u.active,EXISTS(SELECT 1 FROM auth_identities i WHERE i.user_id=u.id) AS login_bound FROM staff_users u WHERE u.operator_id=? AND u.role IN('operator_owner','operator_sales','operator_service','operator_finance') ORDER BY name",a.operator_id).all()).results);
 }
 if(path==='/api/staff'&&method==='POST'){
  roles(a,['operator_owner']);const d=await body(req,['name','role']);
  const name=textField(d.name,'人員姓名',100),role=textField(d.role,'角色',30);
  if(!['operator_sales','operator_service','operator_finance'].includes(role))fail(400,'新增人員僅可選擇業務、維運或財務');
  const id=uid();
  await env.DB.batch([
   stmt(env,'INSERT INTO staff_users(id,operator_id,name,role,active) VALUES(?,?,?,?,0)',id,a.operator_id,name,role),
   audit(env,a,null,null,'staff_created',{user_id:id,role,login_status:'pending_identity_binding'})
  ]);
  return json({id,name,role,active:0,login_bound:0},201);
 }
 const staffMatch=path.match(/^\/api\/staff\/([^/]+)\/status$/);
 if(staffMatch&&method==='PATCH'){
  roles(a,['operator_owner']);const d=await body(req,['active']);
  if(typeof d.active!=='boolean')fail(400,'狀態錯誤');
  if(staffMatch[1]===a.id)fail(400,'不能停用自己的帳號');
  const target=await stmt(env,"SELECT id,active FROM staff_users WHERE operator_id=? AND id=? AND role<>'operator_owner'",a.operator_id,staffMatch[1]).first();
  if(!target)fail(404,'找不到可管理的員工');
  if(d.active&&!demo(req,env)&&!await stmt(env,'SELECT user_id FROM auth_identities WHERE user_id=? AND issuer=?',staffMatch[1],env.ACCESS_ISSUER).first())fail(409,'此人員尚未完成企業登入身分綁定，不能啟用');
  await env.DB.batch([stmt(env,'UPDATE staff_users SET active=? WHERE operator_id=? AND id=?',d.active?1:0,a.operator_id,staffMatch[1]),audit(env,a,null,null,'staff_status',{user_id:staffMatch[1],active:d.active},true)]);
  return json({ok:true});
 }
 if(path==='/api/businesses'&&method==='GET'){
  const s=bizScope(a);const q=(url.searchParams.get('q')||'').slice(0,100);
  return json((await stmt(env,'SELECT b.* FROM businesses b WHERE '+s.sql+' AND b.name LIKE ? ORDER BY b.created_at DESC',...s.args,'%'+q+'%').all()).results);
 }
 if(path==='/api/opportunities'&&method==='GET'){
  const s=opScope(a);const q=(url.searchParams.get('q')||'').slice(0,100);const stage=url.searchParams.get('stage');
  if(stage&&!stages.includes(stage))fail(400,'階段不正確');
  return json((await stmt(env,'SELECT o.*,b.name AS business_name,u.name AS owner_name FROM opportunities o JOIN businesses b ON b.id=o.business_id AND b.operator_id=o.operator_id JOIN staff_users u ON u.id=o.owner_id WHERE '+s.sql+' AND (o.title LIKE ? OR b.name LIKE ?)'+(stage?' AND o.stage=?':'')+' ORDER BY o.updated_at DESC',...s.args,'%'+q+'%','%'+q+'%',...(stage?[stage]:[])).all()).results);
 }
 if(path==='/api/opportunities'&&method==='POST'){
  roles(a,['operator_owner','operator_sales']);
  const d=await body(req,['business_id','business_name','registration_no','contact_name','phone','email','title','source','amount','owner_id','next_action','followup_at']);
  const owner=a.role==='operator_sales'?a.id:await agent(env,a,d.owner_id??a.id);
  if(a.role==='operator_sales'&&d.owner_id!==undefined&&d.owner_id!==a.id)fail(403,'僅能建立自己負責的案件');
  const title=textField(d.title,'案件名稱',150);
  const amount=numberField(d.amount??0,'金額');
  const next=textField(d.next_action??'','下一步',500,true);
  const follow=textField(d.followup_at??'','跟進日期',40,true);
  if(follow&&!Number.isFinite(Date.parse(follow)))fail(400,'跟進日期不正確');
  const source=textField(d.source??'人工建立','來源',100);
  let businessId:string;const commands:Statement[]=[];const time=now();
  if(d.business_id){businessId=textField(d.business_id,'企業',100);await getBusiness(env,a,businessId);}
  else {
   businessId=uid();const name=textField(d.business_name,'企業名稱',150);
   const registration=d.registration_no?textField(d.registration_no,'統編',8):null;
   if(registration&&!/^\d{8}$/.test(registration))fail(400,'統編應為八位數字');
   if(registration&&await stmt(env,'SELECT id FROM businesses WHERE operator_id=? AND registration_no=?',a.operator_id,registration).first())fail(409,'統編已存在，請選取既有企業');
   const contact=textField(d.contact_name,'聯絡人',100);
   const phone=textField(d.phone??'','電話',50,true);const email=textField(d.email??'','Email',200,true);
   commands.push(stmt(env,'INSERT INTO businesses(id,operator_id,name,registration_no,created_at) VALUES(?,?,?,?,?)',businessId,a.operator_id,name,registration,time));
   commands.push(stmt(env,'INSERT INTO contacts(id,operator_id,business_id,name,phone,email) VALUES(?,?,?,?,?,?)',uid(),a.operator_id,businessId,contact,phone,email));
  }
  const id=uid();const cid=uid();
  commands.push(stmt(env,'INSERT INTO opportunities(id,operator_id,business_id,title,owner_id,source,amount,next_action,followup_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,a.operator_id,businessId,title,owner,source,amount,next,follow,time,time));
  commands.push(stmt(env,'INSERT INTO conversations(id,operator_id,business_id,opportunity_id,created_at) VALUES(?,?,?,?,?)',cid,a.operator_id,businessId,id,time));
  commands.push(audit(env,a,businessId,id,'opportunity_created',{owner_id:owner,title}));
  await env.DB.batch(commands);return json({id,business_id:businessId,conversation_id:cid},201);
 }
 const oppMatch=path.match(/^\/api\/opportunities\/([^/]+)$/);
 if(oppMatch&&method==='GET'){
  const o=await getOpportunity(env,a,oppMatch[1]);
  return json({...o,contacts:(await stmt(env,'SELECT id,name,phone,email FROM contacts WHERE operator_id=? AND business_id=?',a.operator_id,o.business_id).all()).results});
 }
 if(oppMatch&&method==='PATCH'){
  roles(a,['operator_owner','operator_sales']);const o=await getOpportunity(env,a,oppMatch[1]);
  const d=await body(req,['version','stage','owner_id','next_action','followup_at','note','amount']);
  const version=numberField(d.version,'版本');
  if(version!==o.version)fail(409,'案件已更新，請重新整理後操作');
  const stage=d.stage===undefined?o.stage:textField(d.stage,'階段',30);
  if(!stages.includes(stage))fail(400,'階段不正確');
  if(stage==='won'&&o.stage!=='won')fail(400,'請使用成交轉租戶操作');
  if(o.stage==='won'&&stage!=='won')fail(400,'成交案件保留紀錄；請另建加購或後續案件');
  const owner=d.owner_id===undefined?o.owner_id:await agent(env,a,d.owner_id);
  const next=d.next_action===undefined?o.next_action:textField(d.next_action,'下一步',500,true);
  const note=d.note===undefined?o.note:textField(d.note,'原因或備註',1000,true);
  if(['paused','lost'].includes(stage)&&!note)fail(400,'請填寫暫緩或未成交原因');
  const follow=d.followup_at===undefined?o.followup_at:textField(d.followup_at,'跟進日期',40,true);
  if(follow&&!Number.isFinite(Date.parse(follow)))fail(400,'跟進日期不正確');
  const amount=d.amount===undefined?o.amount:numberField(d.amount,'金額');
  const r=await env.DB.batch([
   stmt(env,'UPDATE opportunities SET stage=?,owner_id=?,next_action=?,followup_at=?,note=?,amount=?,version=version+1,updated_at=? WHERE id=? AND operator_id=? AND version=?',stage,owner,next,follow,note,amount,now(),o.id,a.operator_id,version),
   audit(env,a,o.business_id,o.id,owner!==o.owner_id?'assignment_changed':'opportunity_updated',{from_owner:o.owner_id,to_owner:owner,from_stage:o.stage,to_stage:stage,note,previous_amount:o.amount,amount,next_action:next,followup_at:follow},true)
  ]);
  if(!r[0].meta.changes)fail(409,'案件已更新，請重新整理');
  return json({ok:true,version:version+1});
 }
 const winMatch=path.match(/^\/api\/opportunities\/([^/]+)\/win$/);
 if(winMatch&&method==='POST'){
  roles(a,['operator_owner','operator_sales']);const o=await getOpportunity(env,a,winMatch[1]);const d=await body(req,['version']);
  if(o.stage==='won')return json({business_id:o.business_id,already_won:true});
  const version=numberField(d.version,'版本');if(version!==o.version)fail(409,'案件已更新');
  if(o.stage!=='billing')fail(409,'請先完成導入並進入收費階段');
  const r=await env.DB.batch([
   stmt(env,"UPDATE opportunities SET stage='won',version=version+1,updated_at=? WHERE id=? AND operator_id=? AND version=?",now(),o.id,a.operator_id,version),
   audit(env,a,o.business_id,o.id,'opportunity_won',{payment_status:o.payment_status,service_status:'not_connected'},true),
   stmt(env,"UPDATE businesses SET is_tenant=1,service_owner_id=COALESCE(service_owner_id,?) WHERE id=? AND operator_id=? AND EXISTS(SELECT 1 FROM opportunities WHERE id=? AND operator_id=? AND stage='won')",a.id,o.business_id,a.operator_id,o.id,a.operator_id)
  ]);
  if(!r[0].meta.changes)fail(409,'案件已更新，請重新整理');
  return json({business_id:o.business_id,already_won:false});
 }
 const paymentMatch=path.match(/^\/api\/opportunities\/([^/]+)\/payment$/);
 if(paymentMatch&&method==='PATCH'){
  roles(a,['operator_owner','operator_finance']);const o=await getOpportunity(env,a,paymentMatch[1]);
  const d=await body(req,['version','payment_status','reference']);const version=numberField(d.version,'版本');
  const status=textField(d.payment_status,'付款狀態',20);if(!['paid','unpaid'].includes(status))fail(400,'付款狀態錯誤');
  const reference=textField(d.reference,'人工核對依據',300);
  const r=await env.DB.batch([stmt(env,'UPDATE opportunities SET payment_status=?,version=version+1,updated_at=? WHERE id=? AND operator_id=? AND version=?',status,now(),o.id,a.operator_id,version),
   audit(env,a,o.business_id,o.id,'payment_recorded',{from:o.payment_status,to:status,reference,method:'manual_record_not_gateway'},true)]);
  if(!r[0].meta.changes)fail(409,'案件已更新');
  return json({ok:true});
 }
 if(path==='/api/tenants'&&method==='POST'){
  roles(a,['operator_owner']);
  const d=await body(req,['business_name','registration_no','contact_name','phone','email','service_owner_id','reference']);
  const name=textField(d.business_name,'企業名稱',150),contact=textField(d.contact_name,'聯絡人',100);
  const registration=d.registration_no?textField(d.registration_no,'統編',8):null;
  if(registration&&!/^\d{8}$/.test(registration))fail(400,'統編應為八位數字');
  if(registration&&await stmt(env,'SELECT id FROM businesses WHERE operator_id=? AND registration_no=?',a.operator_id,registration).first())fail(409,'統編已存在，請沿用既有企業或案件轉租戶');
  const phone=textField(d.phone??'','電話',50,true),email=textField(d.email??'','Email',200,true);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Email 格式不正確');
  const reference=textField(d.reference,'租戶建檔依據',500);
  const assigned=textField(d.service_owner_id??a.id,'服務承辦人',100);
  if(!await stmt(env,"SELECT id FROM staff_users WHERE id=? AND operator_id=? AND active=1 AND role IN('operator_owner','operator_sales','operator_service')",assigned,a.operator_id).first())fail(400,'服務承辦人不屬於本業者或已停權');
  const id=uid(),time=now();
  await env.DB.batch([
   stmt(env,'INSERT INTO businesses(id,operator_id,name,registration_no,is_tenant,service_owner_id,created_at) VALUES(?,?,?,?,1,?,?)',id,a.operator_id,name,registration,assigned,time),
   stmt(env,'INSERT INTO contacts(id,operator_id,business_id,name,phone,email) VALUES(?,?,?,?,?,?)',uid(),a.operator_id,id,contact,phone,email),
   audit(env,a,id,null,'tenant_created',{method:'manual_existing_tenant',reference,service_owner_id:assigned})
  ]);
  return json({business_id:id},201);
 }
 if(path==='/api/tenants'&&method==='GET'){
  const s=bizScope(a);const q=(url.searchParams.get('q')||'').slice(0,100);
  return json((await stmt(env,'SELECT b.*,u.name AS service_owner_name,(SELECT COUNT(*) FROM service_requests sr WHERE sr.operator_id=b.operator_id AND sr.business_id=b.id AND sr.status=\'requested\') AS request_count FROM businesses b LEFT JOIN staff_users u ON u.id=b.service_owner_id WHERE '+s.sql+' AND b.is_tenant=1 AND b.name LIKE ? ORDER BY b.created_at DESC',...s.args,'%'+q+'%').all()).results);
 }
 const bizMatch=path.match(/^\/api\/businesses\/([^/]+)$/);
 if(bizMatch&&method==='GET'){
  const b=await getBusiness(env,a,bizMatch[1]);
  return json({...b,contacts:(await stmt(env,'SELECT id,name,phone,email FROM contacts WHERE operator_id=? AND business_id=?',a.operator_id,b.id).all()).results,
   services:(await stmt(env,'SELECT id,module,status,created_at FROM service_requests WHERE operator_id=? AND business_id=? ORDER BY created_at DESC',a.operator_id,b.id).all()).results});
 }
 const serviceOwnerMatch=path.match(/^\/api\/businesses\/([^/]+)\/assignee$/);
 if(serviceOwnerMatch&&method==='PATCH'){
  roles(a,['operator_owner']);const b=await getBusiness(env,a,serviceOwnerMatch[1]);const d=await body(req,['service_owner_id']);
  const id=textField(d.service_owner_id,'服務承辦人',100);
  const u=await stmt(env,"SELECT id FROM staff_users WHERE id=? AND operator_id=? AND active=1 AND role IN('operator_owner','operator_sales','operator_service')",id,a.operator_id).first();
  if(!u||!b.is_tenant)fail(400,'無效的租戶或承辦人');
  await env.DB.batch([stmt(env,'UPDATE businesses SET service_owner_id=? WHERE id=? AND operator_id=?',id,b.id,a.operator_id),audit(env,a,b.id as string,null,'service_assignment_changed',{from:b.service_owner_id,to:id},true)]);
  return json({ok:true});
 }
 const requestMatch=path.match(/^\/api\/businesses\/([^/]+)\/services$/);
 if(requestMatch&&method==='POST'){
  roles(a,['operator_owner','operator_sales','operator_service']);const b=await getBusiness(env,a,requestMatch[1]);
  if(!b.is_tenant)fail(409,'請先成交轉為租戶');
  const d=await body(req,['module']);const module=textField(d.module,'功能',30);if(!modules.includes(module))fail(400,'功能不正確');
  const id=uid();const time=now();
  const r=await env.DB.batch([stmt(env,"INSERT OR IGNORE INTO service_requests(id,operator_id,business_id,actor_id,module,status,created_at,updated_at) VALUES(?,?,?,?,?,'requested',?,?)",id,a.operator_id,b.id,a.id,module,time,time),
   audit(env,a,b.id as string,null,'service_requested',{module,integration:'not_connected'},true)]);
  const existing=await stmt(env,"SELECT id,module,status FROM service_requests WHERE operator_id=? AND business_id=? AND module=? AND status='requested'",a.operator_id,b.id,module).first();
  return json(existing,r[0].meta.changes?201:200);
 }
 const cancelMatch=path.match(/^\/api\/businesses\/([^/]+)\/services\/([^/]+)$/);
 if(cancelMatch&&method==='PATCH'){
  roles(a,['operator_owner','operator_sales','operator_service']);await getBusiness(env,a,cancelMatch[1]);const d=await body(req,['status']);
  if(d.status!=='cancelled')fail(400,'整合尚未串接，僅可取消申請');
  const r=await env.DB.batch([stmt(env,"UPDATE service_requests SET status='cancelled',updated_at=? WHERE id=? AND operator_id=? AND business_id=? AND status='requested'",now(),cancelMatch[2],a.operator_id,cancelMatch[1]),
  audit(env,a,cancelMatch[1],null,'service_cancelled',{request_id:cancelMatch[2]},true)]);
  if(!r[0].meta.changes)fail(404,'找不到待處理申請');return json({ok:true});
 }
 if(path==='/api/conversations'&&method==='GET'){
  roles(a,['operator_owner','operator_sales','operator_service']);const s=bizScope(a);
  return json((await stmt(env,'SELECT c.*,b.name AS business_name,o.title,o.owner_id,u.name AS owner_name,(SELECT body FROM messages m WHERE m.operator_id=c.operator_id AND m.conversation_id=c.id ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS preview FROM conversations c JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id JOIN opportunities o ON o.id=c.opportunity_id AND o.operator_id=c.operator_id JOIN staff_users u ON u.id=o.owner_id WHERE '+s.sql+(a.role==='operator_sales'?' AND o.owner_id=?':'')+' ORDER BY c.created_at DESC',...s.args,...(a.role==='operator_sales'?[a.id]:[])).all()).results);
 }
 const msgMatch=path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
 if(msgMatch&&method==='GET'){
  await getConversation(env,a,msgMatch[1]);
  return json((await stmt(env,'SELECT m.id,m.actor_id,m.direction,m.body,m.source,m.approved_by,m.status,m.connection_id,m.created_at,m.updated_at,u.name AS actor_name FROM messages m LEFT JOIN staff_users u ON u.id=m.actor_id WHERE m.operator_id=? AND m.conversation_id=? ORDER BY m.created_at,m.rowid',a.operator_id,msgMatch[1]).all()).results);
 }
 if(msgMatch&&method==='POST'){
  const c=await getConversation(env,a,msgMatch[1]);
  const d=await body(req,['body','idempotency_key','simulate_failure']);
  const message=textField(d.body,'訊息',2000);const key=textField(d.idempotency_key,'請求識別碼',100);
  if(!demo(req,env)){
   if(d.simulate_failure!==undefined)fail(400,'正式 LINE 訊息不能指定模擬狀態');
   const result=await enqueueLine(env,a,c,message,key);
   ctx?.waitUntil(dispatchOutbox(env,a.operator_id).catch(()=>console.error('LINE delivery needs recovery')));
   return json(result,202);
  }
  if(d.simulate_failure!==undefined&&typeof d.simulate_failure!=='boolean')fail(400,'測試狀態錯誤');
  const old=await stmt(env,'SELECT id,body,status,actor_id FROM messages WHERE operator_id=? AND conversation_id=? AND idempotency_key=?',a.operator_id,c.id,key).first();
  if(old){if(old.body!==message||old.actor_id!==a.id)fail(409,'識別碼已用於另一則訊息');return json(old);}
  const id=uid();const time=now();const status=d.simulate_failure?'failed':'simulated';
  const r=await env.DB.batch([
   stmt(env,"INSERT OR IGNORE INTO messages(id,operator_id,conversation_id,actor_id,direction,body,source,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,'out',?,'human',?,?,?,?)",id,a.operator_id,c.id,a.id,message,status,key,time,time),
   audit(env,a,c.business_id as string,c.opportunity_id as string,'message_attempted',{message_id:id,status,adapter:'local_only'},true),
   stmt(env,"UPDATE conversations SET first_agent_id=COALESCE(first_agent_id,?) WHERE operator_id=? AND id=? AND EXISTS(SELECT 1 FROM messages WHERE id=? AND status='simulated')",a.id,a.operator_id,c.id,id)
  ]);
  const saved=await stmt(env,'SELECT id,body,status,actor_id FROM messages WHERE operator_id=? AND conversation_id=? AND idempotency_key=?',a.operator_id,c.id,key).first();
  if(saved?.body!==message||saved?.actor_id!==a.id)fail(409,'識別碼衝突');
  return json(saved,r[0].meta.changes?201:200);
 }
 const retryMatch=path.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/retry$/);
 if(retryMatch&&method==='POST'){
  const c=await getConversation(env,a,retryMatch[1]);await body(req,[]);
  const m=await stmt(env,'SELECT * FROM messages WHERE id=? AND operator_id=? AND conversation_id=?',retryMatch[2],a.operator_id,c.id).first();
  if(!m)fail(404,'訊息不存在');
  if(m!.actor_id!==a.id)fail(403,'請原發送人重試，以保留正確歸屬');
  if(m!.connection_id&&m!.direction==='out'){
   const result=await retryLine(env,a,String(m!.id));
   await audit(env,a,c.business_id as string,c.opportunity_id as string,'line_message_retry_requested',{message_id:m!.id}).run();
   ctx?.waitUntil(dispatchOutbox(env,a.operator_id).catch(()=>console.error('LINE delivery needs recovery')));
   return json(result);
  }
  if(m!.status==='simulated')return json({id:m!.id,status:'simulated'});
  if(m!.status!=='failed')fail(409,'此訊息不可重試');
  await env.DB.batch([stmt(env,"UPDATE messages SET status='simulated',updated_at=? WHERE id=? AND operator_id=? AND status='failed'",now(),m!.id,a.operator_id),
   audit(env,a,c.business_id as string,c.opportunity_id as string,'message_retried',{message_id:m!.id,adapter:'local_only'},true),
   stmt(env,'UPDATE conversations SET first_agent_id=COALESCE(first_agent_id,?) WHERE operator_id=? AND id=?',a.id,a.operator_id,c.id)]);
  return json({id:m!.id,status:'simulated'});
 }
 if(path==='/api/activity'&&method==='GET'){
  const businessId=url.searchParams.get('business_id');
  if(businessId)await getBusiness(env,a,businessId);else roles(a,['operator_owner']);
  let extra='';const args:unknown[]=[a.operator_id];
  if(businessId){extra=' AND e.business_id=?';args.push(businessId);}
  if(a.role==='operator_service')extra+=" AND e.action NOT IN('receivable_created','receivable_voided','ledger_recorded','payment_recorded')";
  if(a.role==='operator_finance')extra+=" AND e.action NOT IN('mail_received','mail_status_changed','ticket_created','ticket_status_changed')";
  if(a.role==='operator_sales'){extra+=' AND (e.opportunity_id IS NULL OR EXISTS(SELECT 1 FROM opportunities o WHERE o.id=e.opportunity_id AND o.operator_id=e.operator_id AND o.owner_id=?))';args.push(a.id);}
  return json((await stmt(env,'SELECT e.id,e.action,e.detail,e.created_at,e.business_id,e.opportunity_id,u.name AS actor_name FROM activity_events e JOIN staff_users u ON u.id=e.actor_id WHERE e.operator_id=?'+extra+' ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100',...args).all()).results);
 }
 if(path==='/api/admin/risk'&&method==='GET'){
  roles(a,['operator_owner']);return json({enabled:false,status:'not_enabled',events:[],message:'AI 與風控規則尚未啟用'});
 }
 return fail(404,'找不到此功能');
}
export default {async fetch(req:Request,env:Env,ctx?:Context):Promise<Response>{
 let response:Response;
 try {response=await route(req,env,ctx);} catch(e){
  if(e instanceof HttpError)response=json({error:e.message},e.status);
  else {console.error('Request failed',e instanceof Error?e.message:'unknown');response=json({error:'處理失敗，請重新整理或聯絡管理員'},500);}
 }
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(new URL(req.url).pathname.startsWith('/api/'))headers.set('Cache-Control','no-store');
 return new Response(response.body,{status:response.status,headers});
},async scheduled(_event:unknown,env:Env){await processInbox(env);await dispatchOutbox(env);}};
