import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail} from './shared.js';
import {body,text,version,json,role,requireModule} from './workspace-common.js';
import {monitorRoute} from './chat-monitor.js';
type Row=Record<string,any>;
function period(url:URL){const days=Number(url.searchParams.get('days')||7);if(![1,7,30,90].includes(days))fail(400,'統計期間只支援 1、7、30、90 天');const to=now(),from=new Date(Date.parse(to)-days*86400000).toISOString();return {days,from,to};}
function pagination(url:URL){
 const q=url.searchParams.get('q')||'';if(q.length>100)fail(400,'搜尋文字過長');
 const limit=Number(url.searchParams.get('limit')||30);if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail(400,'每頁最多 50 筆');
 const raw=url.searchParams.get('cursor');let cursor:{at:string;id:string}|null=null;
 if(raw){try{if(raw.length>600)throw 0;const c=JSON.parse(atob(raw));if(!c||Object.keys(c).sort().join(',')!=='at,id'||typeof c.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(c.at)||!Number.isFinite(Date.parse(c.at))||typeof c.id!=='string'||c.id.length>200)throw 0;cursor=c;}catch{fail(400,'分頁格式不正確');}}
 return {q,limit,cursor};
}
async function pageRows(env:Env,base:string,args:unknown[],url:URL,p:{from:string;to:string},searchColumns:string[]){
 const pg=pagination(url);let where='created_at>=? AND created_at<=?',values=[...args,p.from,p.to];
 if(pg.q){where+=' AND ('+searchColumns.map(c=>c+" LIKE ? ESCAPE '\\'").join(' OR ')+')';const q='%'+pg.q.replace(/[\\%_]/g,'\\$&')+'%';values.push(...searchColumns.map(()=>q));}
 const total=await stmt(env,'SELECT COUNT(*) n FROM ('+base+') WHERE '+where,...values).first<Row>();
 if(pg.cursor){where+=' AND (created_at<? OR (created_at=? AND id<?))';values.push(pg.cursor.at,pg.cursor.at,pg.cursor.id);}
 const rows=(await stmt(env,'SELECT * FROM ('+base+') WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT ?',...values,pg.limit+1).all<Row>()).results;
 const more=rows.length>pg.limit,items=rows.slice(0,pg.limit),last=items.at(-1);
 return {items,total:Number(total?.n||0),next_cursor:more&&last?btoa(JSON.stringify({at:last.created_at,id:last.id})):null};
}
const chatBase=`SELECT 'work:'||m.id id,m.created_at,m.body,m.direction,m.status,m.source,c.id conversation_id,NULL contact_id,
 b.name business_name,u.name responder_name,m.actor_id,NULL person_id FROM messages m
 JOIN conversations c ON c.id=m.conversation_id AND c.operator_id=m.operator_id JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id
 LEFT JOIN staff_users u ON u.id=m.actor_id AND u.operator_id=m.operator_id WHERE m.operator_id=?
 UNION ALL SELECT 'inbox:'||e.connection_id||':'||e.event_id,e.received_at,COALESCE(e.body,''),'in',CASE WHEN e.body IS NULL THEN 'removed' ELSE 'received' END,'customer',
 NULL,lc.id,'未分派 LINE 來客',NULL,NULL,cl.person_id FROM line_events e JOIN line_contacts lc ON lc.connection_id=e.connection_id AND lc.user_id=e.user_id AND lc.operator_id=e.operator_id
 LEFT JOIN crm_line_links cl ON cl.line_contact_id=lc.id AND cl.operator_id=lc.operator_id
 WHERE e.operator_id=? AND e.kind='message' AND e.state IN('pending','unmatched')`;
const groupBase=`SELECT o.id,m.created_at,o.created_at detected_at,o.status,o.version,o.person_id,r.name rule_name,g.name group_name,g.id group_id,
 CASE WHEN m.removed=1 THEN '' ELSE m.body END body,m.removed,m.created_at message_at FROM monitor_group_opportunities o
 JOIN monitor_group_rules r ON r.id=o.rule_id AND r.operator_id=o.operator_id
 JOIN monitor_group_messages m ON m.id=o.message_id AND m.operator_id=o.operator_id JOIN monitor_groups g ON g.id=m.group_id AND g.operator_id=m.operator_id WHERE o.operator_id=?`;
async function usage(env:Env,a:Actor,p:{from:string;to:string}){
 const aggregate=`COUNT(*) requests,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
 CASE WHEN COUNT(input_tokens)=COUNT(*) THEN COALESCE(SUM(input_tokens),0) END input_tokens,
 CASE WHEN COUNT(output_tokens)=COUNT(*) THEN COALESCE(SUM(output_tokens),0) END output_tokens,
 CASE WHEN COUNT(total_tokens)=COUNT(*) THEN COALESCE(SUM(total_tokens),0) END total_tokens,
 CASE WHEN COUNT(provider_cost_micros)=COUNT(*) THEN COALESCE(SUM(provider_cost_micros),0) END provider_cost_micros,
 CASE WHEN COUNT(billable_cost_micros)=COUNT(*) THEN COALESCE(SUM(billable_cost_micros),0) END billable_cost_micros`;
 const filter=' FROM ai_call_ledger WHERE operator_id=? AND created_at>=? AND created_at<=?';
 const values=[a.operator_id,p.from,p.to];const results=await env.DB.batch([
  stmt(env,'SELECT '+aggregate+filter,...values),
  stmt(env,'SELECT feature,'+aggregate+filter+' GROUP BY feature ORDER BY requests DESC LIMIT 30',...values),
  stmt(env,'SELECT provider,model,'+aggregate+filter+' GROUP BY provider,model ORDER BY requests DESC LIMIT 30',...values),
  stmt(env,'SELECT actor_id,(SELECT name FROM staff_users WHERE id=actor_id AND operator_id=ai_call_ledger.operator_id) actor_name,'+aggregate+filter+' GROUP BY actor_id ORDER BY requests DESC LIMIT 50',...values)
 ]);return {total:results[0].results[0],by_feature:results[1].results,by_model:results[2].results,by_actor:results[3].results,currency:'USD',billing_enabled:false};
}
async function overview(env:Env,a:Actor,p:{from:string;to:string},tab:string){
 const op=a.operator_id;
 const groups=tab==='groups';
 const r=await env.DB.batch([
  stmt(env,groups?`SELECT COUNT(DISTINCT m.id) messages,COUNT(DISTINCT m.member_hash) members FROM monitor_group_messages m
   WHERE m.operator_id=? AND m.created_at>=? AND m.created_at<=? AND m.removed=0 AND EXISTS(SELECT 1 FROM monitor_group_opportunities o WHERE o.message_id=m.id AND o.operator_id=m.operator_id)`:
   `SELECT COUNT(*) messages,COUNT(DISTINCT COALESCE(conversation_id,contact_id)) members FROM (${chatBase}) WHERE created_at>=? AND created_at<=?`,...(groups?[op,p.from,p.to]:[op,op,p.from,p.to])),
  stmt(env,groups?"SELECT COUNT(*) pending FROM monitor_group_opportunities o JOIN monitor_group_messages m ON m.id=o.message_id AND m.operator_id=o.operator_id WHERE o.operator_id=? AND o.status IN('pending','reviewing') AND m.created_at>=? AND m.created_at<=?":"SELECT COUNT(*) pending FROM risk_events WHERE operator_id=? AND status IN('pending','reviewing') AND created_at>=? AND created_at<=?",op,p.from,p.to),
  stmt(env,"SELECT COUNT(*) new_opportunities FROM monitor_group_opportunities o JOIN monitor_group_messages m ON m.id=o.message_id AND m.operator_id=o.operator_id WHERE o.operator_id=? AND o.status IN('pending','accepted') AND m.created_at>=? AND m.created_at<=?",op,p.from,p.to),
  stmt(env,'SELECT COUNT(*) enabled_groups FROM monitor_groups WHERE operator_id=? AND enabled=1 AND departed=0',op),
  stmt(env,'SELECT COUNT(*) enabled_rules FROM monitor_group_rules WHERE operator_id=? AND enabled=1',op),
  stmt(env,"SELECT COUNT(*) attention FROM messages WHERE operator_id=? AND status IN('failed','unknown','blocked') AND created_at>=? AND created_at<=?",op,p.from,p.to)
 ]);return Object.assign({},...r.map(x=>x.results[0]));
}
function terms(value:unknown,label:string){if(!Array.isArray(value)||value.length<1||value.length>10||value.some(v=>typeof v!=='string'||!v.trim()||v.length>80))fail(400,label+'請填 1 至 10 個用語');return JSON.stringify([...new Set((value as string[]).map(v=>v.trim()))]);}
export async function monitorConsoleRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/admin/monitor'))return null;
 role(a,['operator_owner']);await requireModule(env,a,'monitor');
 if(path==='/api/admin/monitor'&&req.method==='GET'){
  const tab=url.searchParams.get('tab')||'chat';if(!['chat','usage','groups','calls'].includes(tab))fail(400,'監控分頁格式不正確');
  const p=period(url),status=url.searchParams.get('status')||'all';pagination(url);
  let data:Row={};
  if(tab==='chat'){
   if(!['all','attention','in','out'].includes(status))fail(400,'紀錄篩選格式不正確');
   const filter=status==='attention'?"status IN('failed','unknown','blocked')":status==='all'?'1=1':"direction='"+status+"'";
   data=await pageRows(env,'SELECT * FROM ('+chatBase+') WHERE '+filter,[a.operator_id,a.operator_id],url,p,['business_name','body','responder_name']);
   const legacy=await monitorRoute(new Request(url.origin+'/api/admin/risk?days='+p.days),env,a);data.legacy=await legacy!.json();
  }
  if(tab==='usage')data=await usage(env,a,p);
  if(tab==='calls'){
   if(!['all','success','failed','cached','fallback'].includes(status))fail(400,'呼叫篩選格式不正確');
   const filter=status==='all'?'':" AND status='"+status+"'";
   data=await pageRows(env,`SELECT id,created_at,feature,provider,model,status,input_tokens,output_tokens,total_tokens,provider_cost_micros,billable_cost_micros,latency_ms,error_code,pricing_version,(SELECT name FROM staff_users WHERE id=actor_id AND operator_id=l.operator_id) actor_name FROM ai_call_ledger l WHERE operator_id=?`+filter,[a.operator_id],url,p,['feature','provider','model']);
  }
  if(tab==='groups'){
   if(!['all','pending','reviewing','accepted','discarded'].includes(status))fail(400,'商機篩選格式不正確');
   data=await pageRows(env,'SELECT * FROM ('+groupBase+') WHERE '+(status==='all'?'1=1':"status='"+status+"'"),[a.operator_id],url,p,['group_name','rule_name','body']);
   data.groups=(await stmt(env,'SELECT id,name,enabled,departed,source_type,version,last_event_at FROM monitor_groups WHERE operator_id=? ORDER BY last_event_at DESC,id DESC LIMIT 100',a.operator_id).all()).results;
   data.rules=(await stmt(env,'SELECT id,name,keywords,context_words,enabled,version FROM monitor_group_rules WHERE operator_id=? ORDER BY updated_at DESC LIMIT 20',a.operator_id).all<Row>()).results.map(r=>({...r,keywords:JSON.parse(r.keywords),context_words:JSON.parse(r.context_words)}));
   data.reviews=(await stmt(env,'SELECT r.action,r.reference,r.created_at,u.name actor_name FROM monitor_group_reviews r JOIN staff_users u ON u.id=r.actor_id AND u.operator_id=r.operator_id WHERE r.operator_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50',a.operator_id).all()).results;
  }
  return json({tab,period:p,stats:['chat','groups'].includes(tab)?await overview(env,a,p,tab):{},...data,updated_at:now(),ai_enabled:false,external_send_enabled:false});
 }
 const chat=path.match(/^\/api\/admin\/monitor\/chats\/([^/]+)$/);
 if(chat&&req.method==='GET'){
  const p=period(url),c=await stmt(env,'SELECT c.id,b.name business_name FROM conversations c JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id WHERE c.id=? AND c.operator_id=?',chat[1],a.operator_id).first();if(!c)fail(404,'找不到此聊天室');
  const items=(await stmt(env,`SELECT m.id,m.direction,m.body,m.status,m.source,m.created_at,u.name responder_name,q.state delivery_state,q.last_error delivery_error
   FROM messages m LEFT JOIN staff_users u ON u.id=m.actor_id AND u.operator_id=m.operator_id LEFT JOIN line_outbox q ON q.id=m.id AND q.operator_id=m.operator_id
   WHERE m.operator_id=? AND m.conversation_id=? AND m.created_at>=? AND m.created_at<=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,a.operator_id,chat[1],p.from,p.to).all()).results;return json({chat:c,items,period:p});
 }
 const inbox=path.match(/^\/api\/admin\/monitor\/inbox\/([^/]+)$/);
 if(inbox&&req.method==='GET'){
  const p=period(url),c=await stmt(env,'SELECT id,connection_id,user_id FROM line_contacts WHERE id=? AND operator_id=?',inbox[1],a.operator_id).first<Row>();if(!c)fail(404,'找不到此來客');
  const items=(await stmt(env,"SELECT event_id id,COALESCE(body,'') body,received_at created_at,CASE WHEN body IS NULL THEN 'removed' ELSE 'received' END status,'in' direction FROM line_events WHERE operator_id=? AND connection_id=? AND user_id=? AND kind='message' AND received_at>=? AND received_at<=? ORDER BY event_at DESC,event_id DESC LIMIT 100",a.operator_id,c.connection_id,c.user_id,p.from,p.to).all()).results;return json({chat:{id:c.id,business_name:'未分派 LINE 來客'},items,period:p});
 }
 const group=path.match(/^\/api\/admin\/monitor\/groups\/([^/]+)$/);
 if(group&&req.method==='PATCH'){
  const d=await body(req,['name','enabled','version','reference']),name=text(d.name,'群組名稱',100),reference=text(d.reference,'啟停依據',500);
  if(typeof d.enabled!=='boolean')fail(400,'啟用格式不正確');
  const r=await env.DB.batch([
   stmt(env,'UPDATE monitor_groups SET name=?,enabled=?,version=version+1 WHERE operator_id=? AND id=? AND version=? AND (departed=0 OR ?=0)',name,d.enabled?1:0,a.operator_id,group[1],version(d.version),d.enabled?1:0),
   stmt(env,"INSERT INTO monitor_group_reviews(id,operator_id,actor_id,action,target_id,reference,created_at) SELECT ?,?,?,'group_configured',?,?,? WHERE changes()>0",uid(),a.operator_id,a.id,group[1],reference,now())
  ]);if(!r[0].meta.changes)fail(409,'群組已更新、已離開或不存在');return json({enabled:d.enabled,ai_enabled:false});
 }
 const rule=path.match(/^\/api\/admin\/monitor\/group-rules(?:\/([^/]+))?$/);
 if(rule&&['POST','PATCH'].includes(req.method)){
  const d=await body(req,['name','keywords','context_words','enabled','version']),name=text(d.name,'規則名稱',100),keywords=terms(d.keywords,'關鍵字'),contexts=terms(d.context_words,'情境用語');if(typeof d.enabled!=='boolean')fail(400,'啟用格式不正確');
  const id=rule[1]||uid();if(!rule[1]&&Number((await stmt(env,'SELECT COUNT(*) n FROM monitor_group_rules WHERE operator_id=?',a.operator_id).first<Row>())?.n)>=20)fail(409,'群組規則最多 20 個');
  const r=await env.DB.batch([
   rule[1]?stmt(env,'UPDATE monitor_group_rules SET name=?,keywords=?,context_words=?,enabled=?,version=version+1,updated_at=? WHERE operator_id=? AND id=? AND version=?',name,keywords,contexts,d.enabled?1:0,now(),a.operator_id,id,version(d.version)):
    stmt(env,'INSERT INTO monitor_group_rules(id,operator_id,name,keywords,context_words,enabled,updated_at) VALUES(?,?,?,?,?,?,?)',id,a.operator_id,name,keywords,contexts,d.enabled?1:0,now()),
   stmt(env,"INSERT INTO monitor_group_reviews(id,operator_id,actor_id,action,target_id,created_at) SELECT ?,?,?,'group_rule_saved',?,? WHERE changes()>0",uid(),a.operator_id,a.id,id,now())
  ]);if(!r[0].meta.changes)fail(409,'規則已更新或不存在');return json({id,ai_enabled:false},rule[1]?200:201);
 }
 if(path==='/api/admin/monitor/group-scan'&&req.method==='POST'){
  const d=await body(req,['days']),p=period(new URL(url.origin+'/?days='+d.days));
  const rules=(await stmt(env,'SELECT id,keywords,context_words FROM monitor_group_rules WHERE operator_id=? AND enabled=1 LIMIT 20',a.operator_id).all<Row>()).results;if(!rules.length)fail(409,'尚未啟用群組規則');
  const commands=rules.map(r=>stmt(env,`INSERT OR IGNORE INTO monitor_group_opportunities(id,operator_id,rule_id,message_id,created_at)
   SELECT lower(hex(randomblob(16))),?,?,m.id,? FROM monitor_group_messages m JOIN monitor_groups g ON g.id=m.group_id AND g.operator_id=m.operator_id
   WHERE m.operator_id=? AND g.enabled=1 AND g.departed=0 AND m.removed=0 AND m.created_at>=? AND m.created_at<=?
   AND m.id IN(SELECT id FROM monitor_group_messages WHERE operator_id=? ORDER BY created_at DESC,id DESC LIMIT 500)
   AND EXISTS(SELECT 1 FROM json_each(?) k WHERE instr(lower(m.body),lower(k.value))>0)
   AND EXISTS(SELECT 1 FROM json_each(?) k WHERE instr(lower(m.body),lower(k.value))>0)`,a.operator_id,r.id,now(),a.operator_id,p.from,p.to,a.operator_id,r.keywords,r.context_words));
  commands.push(stmt(env,"INSERT INTO monitor_group_reviews(id,operator_id,actor_id,action,target_id,reference,created_at) VALUES(?,?,?,'group_rules_scanned','',?,?)",uid(),a.operator_id,a.id,'規則掃描，期間 '+p.days+' 天，上限 500 則；無 AI 呼叫',now()));
  const r=await env.DB.batch(commands);return json({created:r.slice(0,-1).reduce((n,r)=>n+r.meta.changes,0),ai_enabled:false});
 }
 const opportunity=path.match(/^\/api\/admin\/monitor\/opportunities\/([^/]+)$/);
 if(opportunity&&req.method==='PATCH'){
  const d=await body(req,['status','person_id','reference','version']),status=text(d.status,'商機狀態',20),reference=text(d.reference,'確認依據',1000),person=d.person_id?text(d.person_id,'會員',100):null;
  if(!['pending','reviewing','accepted','discarded'].includes(status))fail(400,'商機狀態格式不正確');
  if(person){await requireModule(env,a,'crm');if(!await stmt(env,"SELECT id FROM crm_people WHERE id=? AND operator_id=? AND status='active'",person,a.operator_id).first())fail(400,'會員不屬於本業者或已封存');}
  const r=await env.DB.batch([
   stmt(env,'UPDATE monitor_group_opportunities SET status=?,person_id=?,version=version+1 WHERE operator_id=? AND id=? AND version=?',status,person,a.operator_id,opportunity[1],version(d.version)),
   stmt(env,"INSERT INTO monitor_group_reviews(id,operator_id,actor_id,action,target_id,reference,created_at) SELECT ?,?,?,'group_opportunity_reviewed',?,?,? WHERE changes()>0",uid(),a.operator_id,a.id,opportunity[1],reference,now())
  ]);if(!r[0].meta.changes)fail(409,'商機已更新或不存在');return json({ok:true,case_created:false});
 }
 return fail(404,'找不到此監控操作');
}
