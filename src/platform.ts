import type {Actor,Env} from './types.js';
import {fail,stmt,uid,now} from './shared.js';
const json=(d:unknown,status=200)=>Response.json(d,{status});
export async function platformAccess(env:Env,a:Actor){
 if(a.role==='platform_admin')return true;
 return a.role==='operator_owner'&&!!await stmt(env,'SELECT user_id FROM platform_admin_grants WHERE user_id=? AND active=1',a.id).first();
}
function paging(url:URL){
 const offset=Number(url.searchParams.get('offset')||0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)fail(400,'分頁格式不正確');
 return {offset,q:(url.searchParams.get('q')||'').slice(0,100),limit:50};
}
export async function platformRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/platform/'))return null;
 if(!await platformAccess(env,a))fail(403,'僅系統總管理員可進入系統後台');
 if(path==='/api/platform/overview'&&req.method==='GET'){
  const stats=await stmt(env,`SELECT (SELECT COUNT(*) FROM operators) AS operators,
   (SELECT COUNT(*) FROM line_connections) AS connections,
   (SELECT COUNT(*) FROM line_connections WHERE enabled=1) AS receiving,
   (SELECT COUNT(*) FROM line_connections WHERE last_webhook_at IS NOT NULL) AS verified`).first();
  return json({stats,phase:'address_only',platform_oa:'signed_receiver_available',push_enabled:false,payment_enabled:false,ai_enabled:false,settlement_enabled:false});
 }
 if(path==='/api/platform/operators'&&req.method==='GET'){
  const p=paging(url),where='o.name LIKE ?';
  const count=await stmt(env,'SELECT COUNT(*) n FROM operators o WHERE '+where,'%'+p.q+'%').first<{n:number}>();
  const items=(await stmt(env,`SELECT o.id,o.name,
   (SELECT COUNT(*) FROM staff_users u WHERE u.operator_id=o.id AND u.active=1 AND u.role LIKE 'operator_%') AS staff_count,
   (SELECT COUNT(*) FROM line_connections l WHERE l.operator_id=o.id) AS oa_count
   FROM operators o WHERE ${where} ORDER BY o.id LIMIT ? OFFSET ?`,'%'+p.q+'%',p.limit,p.offset).all()).results;
  return json({items,total:count?.n||0,offset:p.offset,limit:p.limit});
 }
 if(path==='/api/platform/connections'&&req.method==='GET'){
  const p=paging(url),where='(o.name LIKE ? OR l.name LIKE ?)';
  const count=await stmt(env,'SELECT COUNT(*) n FROM line_connections l JOIN operators o ON o.id=l.operator_id WHERE '+where,'%'+p.q+'%','%'+p.q+'%').first<{n:number}>();
  const items=(await stmt(env,`SELECT l.id,l.operator_id,o.name AS operator_name,l.name,l.enabled,l.verified_at,l.last_webhook_at,
   EXISTS(SELECT 1 FROM line_connection_secrets s WHERE s.connection_id=l.id AND s.operator_id=l.operator_id) AS encrypted_credentials
   FROM line_connections l JOIN operators o ON o.id=l.operator_id WHERE ${where} ORDER BY l.operator_id,l.id LIMIT ? OFFSET ?`,'%'+p.q+'%','%'+p.q+'%',p.limit,p.offset).all()).results;
  // Status only: no credentials, customer identities, message bodies or inbox previews.
  return json({items,total:count?.n||0,offset:p.offset,limit:p.limit,push_enabled:false});
 }
 if(path==='/api/platform/revenue'&&req.method==='GET'){
  const p=paging(url),count=await stmt(env,'SELECT COUNT(*) n FROM operators WHERE name LIKE ?','%'+p.q+'%').first<{n:number}>();
  const operators=(await stmt(env,'SELECT id,name FROM operators WHERE name LIKE ? ORDER BY id LIMIT ? OFFSET ?','%'+p.q+'%',p.limit,p.offset).all()).results;
  const ids=operators.map(o=>o.id);
  const terms=ids.length?(await stmt(env,'SELECT * FROM digital_revenue_terms WHERE operator_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY operator_id,module',...ids).all()).results:[];
  return json({operators,terms,total:count?.n||0,offset:p.offset,limit:p.limit,settlement_enabled:false});
 }
 if(path==='/api/platform/settings'&&req.method==='GET')return json({settings:await stmt(env,'SELECT oa_name,provider_id,channel_id,purpose,onboarding_template,service_template,monthly_limit,version,updated_at FROM platform_settings WHERE id=1').first(),status:'planning',connected:false,push_enabled:false});
 if(path==='/api/platform/settings'&&req.method==='PATCH'){
  const raw=await req.text();if(raw.length>10000)fail(413,'內容過長');
  if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
  let d:Record<string,unknown>;try{d=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}
  const keys=['version','oa_name','provider_id','channel_id','purpose','onboarding_template','service_template','monthly_limit','reference'];
  if(!d!||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!keys.includes(k)))fail(400,'包含不允許的欄位');
  const text=(k:string,max:number)=>{const v=d[k];if(typeof v!=='string'||v.length>max)fail(400,'欄位格式不正確');return (v as string).trim();};
  const name=text('oa_name',100),provider=text('provider_id',20),channel=text('channel_id',20),purpose=text('purpose',500),onboard=text('onboarding_template',1000),service=text('service_template',1000),reference=text('reference',500);
  if(!reference)fail(400,'請填更新依據');
  if(provider&&!/^\d{1,20}$/.test(provider)||channel&&!/^\d{1,20}$/.test(channel))fail(400,'Provider／Channel ID 格式不正確');
  if(!Number.isSafeInteger(d.version)||Number(d.version)<1)fail(400,'版本格式不正確');
  const limit=d.monthly_limit;if(limit!==null&&(!Number.isSafeInteger(limit)||Number(limit)<0||Number(limit)>1000000))fail(400,'規劃額度格式不正確');
  const at=now();
  const results=await env.DB.batch([
   stmt(env,'UPDATE platform_settings SET oa_name=?,provider_id=?,channel_id=?,purpose=?,onboarding_template=?,service_template=?,monthly_limit=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=?',name,provider,channel,purpose,onboard,service,limit,at,a.id,d.version),
   stmt(env,"INSERT INTO platform_activity(id,actor_id,action,detail,created_at) SELECT ?,?,'platform_planning_updated',?,? WHERE changes()>0",uid(),a.id,JSON.stringify({reference,fields:keys.filter(k=>!['version','reference'].includes(k))}),at)
  ]);
  if(!results[0].meta.changes)fail(409,'設定已更新，請重新整理');
  return json({ok:true,status:'planning',connected:false,push_enabled:false});
 }
 if(path==='/api/platform/activity'&&req.method==='GET')return json((await stmt(env,'SELECT p.id,p.action,p.detail,p.created_at,u.name AS actor_name FROM platform_activity p JOIN staff_users u ON u.id=p.actor_id ORDER BY p.created_at DESC,p.id DESC LIMIT 50').all()).results);
 return fail(404,'系統後台操作不存在');
}
