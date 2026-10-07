import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail} from './shared.js';
import {body,text,version,json,role,requireModule} from './workspace-common.js';
export async function monitorRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const path=new URL(req.url).pathname;if(!path.startsWith('/api/admin/risk'))return null;
 role(a,['operator_owner']);await requireModule(env,a,'monitor');
 if(path==='/api/admin/risk'&&req.method==='GET'){
  const rules=(await stmt(env,'SELECT * FROM risk_rules WHERE operator_id=? ORDER BY updated_at DESC LIMIT 20',a.operator_id).all()).results;
  const events=(await stmt(env,`SELECT r.id,r.status,r.version,r.created_at,rr.name AS rule_name,m.status AS message_status,
   CASE WHEN m.status='removed' THEN '' ELSE m.body END AS body,m.direction,m.source,m.created_at AS message_at,
   u.name AS responder_name,b.name AS business_name,c.opportunity_id
   FROM risk_events r JOIN risk_rules rr ON rr.id=r.rule_id AND rr.operator_id=r.operator_id
   JOIN messages m ON m.id=r.message_id AND m.operator_id=r.operator_id
   JOIN conversations c ON c.id=m.conversation_id AND c.operator_id=m.operator_id
   JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id
   LEFT JOIN staff_users u ON u.id=m.actor_id WHERE r.operator_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,a.operator_id).all()).results;
  const stats=await stmt(env,`SELECT
   (SELECT COUNT(*) FROM line_contacts WHERE operator_id=?) AS visitors,
   (SELECT COUNT(*) FROM line_contacts WHERE operator_id=? AND conversation_id IS NULL) AS unassigned,
   (SELECT COUNT(*) FROM opportunities WHERE operator_id=? AND stage NOT IN('won','lost') AND followup_at!='' AND followup_at<?) AS overdue,
   (SELECT COUNT(*) FROM risk_events WHERE operator_id=? AND status IN('pending','reviewing')) AS pending`,a.operator_id,a.operator_id,a.operator_id,now(),a.operator_id).first();
  const responders=(await stmt(env,`SELECT u.id,u.name,COUNT(m.id) AS replies,MAX(m.created_at) AS last_reply,
   SUM(CASE WHEN m.status IN('failed','unknown','blocked') THEN 1 ELSE 0 END) AS needs_attention
   FROM staff_users u LEFT JOIN messages m ON m.actor_id=u.id AND m.operator_id=u.operator_id AND m.direction='out' AND m.created_at>=?
   WHERE u.operator_id=? AND u.role IN('operator_owner','operator_sales','operator_service') GROUP BY u.id ORDER BY replies DESC,u.name LIMIT 100`,new Date(Date.now()-30*86400000).toISOString(),a.operator_id).all()).results;
  const reviews=(await stmt(env,'SELECT r.id,r.event_id,r.action,r.detail,r.created_at,u.name AS actor_name FROM risk_reviews r JOIN staff_users u ON u.id=r.actor_id WHERE r.operator_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50',a.operator_id).all()).results;
  const enabled=rules.some(r=>r.enabled===1);
  return json({enabled,status:enabled?'rules_only':'not_enabled',ai_enabled:false,rules:rules.map(r=>({...r,keywords:JSON.parse(String(r.keywords))})),events,stats,responders,reviews,message:enabled?'私有規則核查已設定；AI 模型尚未啟用':'AI 與風控規則尚未啟用',data_gaps:['無法歸屬原生 OA 後台的人工回覆者','不讀取私人 LINE 或外部聯繫','規則命中僅供人工核查，不代表截單成立'],scan_scope:'人工掃描最近 200 則平台出站紀錄；不發送告警訊息'});
 }
 const rules=path.match(/^\/api\/admin\/risk\/rules(?:\/([^/]+))?$/);
 if(rules&&['POST','PATCH'].includes(req.method)){
  const d=await body(req,['name','keywords','enabled','version']),name=text(d.name,'規則名稱',100);
  if(!Array.isArray(d.keywords)||!d.keywords.length||d.keywords.length>10||d.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>80)||typeof d.enabled!=='boolean')fail(400,'請填 1 至 10 個核查用語，每個最多 80 字');
  const keywords=JSON.stringify([...new Set(d.keywords.map(k=>(k as string).trim()))]),id=rules[1]||uid();
  if(!rules[1]&&Number((await stmt(env,'SELECT COUNT(*) n FROM risk_rules WHERE operator_id=?',a.operator_id).first())?.n)>=20)fail(409,'最多 20 個私有規則');
  const r=await env.DB.batch([
   rules[1]?stmt(env,'UPDATE risk_rules SET name=?,keywords=?,enabled=?,version=version+1,updated_at=? WHERE operator_id=? AND id=? AND version=?',name,keywords,d.enabled?1:0,now(),a.operator_id,id,version(d.version)):stmt(env,'INSERT INTO risk_rules(id,operator_id,name,keywords,enabled,updated_at) VALUES(?,?,?,?,?,?)',id,a.operator_id,name,keywords,d.enabled?1:0,now()),
   stmt(env,"INSERT INTO risk_reviews(id,operator_id,actor_id,action,detail,created_at) SELECT ?,?,?,'rule_saved',?,? WHERE changes()>0",uid(),a.operator_id,a.id,JSON.stringify({rule_id:id,enabled:d.enabled}),now())
  ]);if(!r[0].meta.changes)fail(409,'私有規則已更新');return json({id,ai_enabled:false},rules[1]?200:201);
 }
 if(path==='/api/admin/risk/scan'&&req.method==='POST'){
  await body(req,[]);const rules=(await stmt(env,'SELECT id,keywords FROM risk_rules WHERE operator_id=? AND enabled=1 LIMIT 20',a.operator_id).all()).results;
  if(!rules.length)fail(409,'尚未啟用私有核查規則');
  const at=now(),commands=rules.map(r=>stmt(env,`INSERT OR IGNORE INTO risk_events(id,operator_id,rule_id,message_id,created_at)
   SELECT lower(hex(randomblob(16))),?,?,m.id,? FROM messages m WHERE m.operator_id=? AND m.direction='out' AND m.status!='removed'
   AND m.id IN(SELECT id FROM messages WHERE operator_id=? AND direction='out' ORDER BY created_at DESC,id DESC LIMIT 200)
   AND EXISTS(SELECT 1 FROM json_each(?) k WHERE instr(lower(m.body),lower(k.value))>0)`,a.operator_id,r.id,at,a.operator_id,a.operator_id,r.keywords));
  commands.push(stmt(env,"INSERT INTO risk_reviews(id,operator_id,actor_id,action,detail,created_at) VALUES(?,?,?,'rules_scanned',?,?)",uid(),a.operator_id,a.id,JSON.stringify({rule_count:rules.length,limit:200,source:'private_rules',ai_enabled:false}),at));
  const r=await env.DB.batch(commands);return json({created:r.slice(0,-1).reduce((n,r)=>n+r.meta.changes,0),ai_enabled:false,notified:false});
 }
 const review=path.match(/^\/api\/admin\/risk\/events\/([^/]+)$/);
 if(review&&req.method==='PATCH'){
  const d=await body(req,['status','version','reference']),status=text(d.status,'核查狀態',20),reference=text(d.reference,'核查依據',1000);
  if(!['pending','reviewing','normal','false_positive','confirmed'].includes(status))fail(400,'核查狀態格式不正確');
  const r=await env.DB.batch([stmt(env,'UPDATE risk_events SET status=?,version=version+1 WHERE operator_id=? AND id=? AND version=?',status,a.operator_id,review[1],version(d.version)),
   stmt(env,"INSERT INTO risk_reviews(id,operator_id,event_id,actor_id,action,detail,created_at) SELECT ?,?,?,?,'event_reviewed',?,? WHERE changes()>0",uid(),a.operator_id,review[1],a.id,JSON.stringify({status,reference}),now())]);
  if(!r[0].meta.changes)fail(409,'核查事件已更新或不存在');return json({ok:true});
 }
 return fail(404,'找不到此核查操作');
}
