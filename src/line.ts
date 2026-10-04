import type {Env,Actor} from './types.js';
import {fail,stmt,now,uid,audit} from './shared.js';
type Row=Record<string,any>;
type Connection={id:string;operator_id:string;provider_id:string;channel_id:string;destination:string;enabled:number};
type Secret={channelSecret?:string;channelAccessToken?:string};
function secrets(env:Env,id:string):Secret{
 try{const raw=JSON.parse(env.LINE_CHANNELS_JSON||'{}');const v=raw[id];return v&&typeof v==='object'?v:{};}catch{return {};}
}
async function connection(env:Env,id:string){
 return stmt(env,'SELECT * FROM line_connections WHERE id=?',id).first<Connection>();
}
const sendEnabled=(env:Env)=>['staging','production'].includes(env.APP_ENV||'')&&env.LINE_SEND_ENABLED==='on';
async function rawBody(req:Request){
 const reader=req.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();fail(413,'Webhook 過大');}chunks.push(value);}
 const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
export async function receiveWebhook(req:Request,env:Env,id:string){
 const c=await connection(env,id);if(!c||!c.enabled)fail(404,'未設定 LINE channel');
 const secret=secrets(env,id).channelSecret;if(typeof secret!=='string'||!secret)fail(503,'LINE 驗簽尚未設定');
 const bytes=await rawBody(req);const signature=req.headers.get('x-line-signature')||'';
 let valid=false;
 try{
  const signatureBytes=Uint8Array.from(atob(signature),v=>v.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  valid=signatureBytes.length===32&&await crypto.subtle.verify('HMAC',key,signatureBytes,bytes);
 }catch{valid=false;}
 if(!valid)fail(401,'Webhook 簽章無效');
 let payload:Row;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail(400,'Webhook 格式錯誤');}
 if(!payload||payload.destination!==c.destination||!Array.isArray(payload.events)||payload.events.length>100)fail(400,'Webhook channel 或事件格式錯誤');
 const commands=[];const time=now();
 // Persist removals before messages so out-of-order/redelivered content cannot reappear.
 for(const event of payload.events){
  if(event?.type==='unsend'&&typeof event.unsend?.messageId==='string'&&event.unsend.messageId.length<=100){
   const mid=event.unsend.messageId;
   commands.push(stmt(env,'INSERT OR IGNORE INTO line_unsends(connection_id,provider_message_id) VALUES(?,?)',c.id,mid));
   commands.push(stmt(env,"UPDATE messages SET body='',status='removed',updated_at=? WHERE connection_id=? AND provider_message_id=?",time,c.id,mid));
   commands.push(stmt(env,"UPDATE line_events SET body=NULL WHERE connection_id=? AND provider_message_id=?",c.id,mid));
  }
 }
 for(const event of payload.events){
  if(!event||typeof event.webhookEventId!=='string'||!event.webhookEventId||event.webhookEventId.length>100||!Number.isSafeInteger(event.timestamp)||event.timestamp<0||event.timestamp>8640000000000000)fail(400,'事件識別或時間錯誤');
  const user=event.source?.type==='user'&&typeof event.source.userId==='string'&&event.source.userId.length<=100?event.source.userId:'';
  const text=event.type==='message'&&event.message?.type==='text'&&typeof event.message.text==='string'&&event.message.text.length<=5000&&typeof event.message.id==='string'&&event.message.id.length<=100;
  const mid=text?event.message.id:event.type==='unsend'&&typeof event.unsend?.messageId==='string'?event.unsend.messageId:null;
  const supported=!!user&&text;
  if(user)commands.push(stmt(env,'INSERT OR IGNORE INTO line_contacts(id,operator_id,connection_id,user_id,created_at) VALUES(?,?,?,?,?)',uid(),c.operator_id,c.id,user,time));
  commands.push(stmt(env,"INSERT OR IGNORE INTO line_events(connection_id,event_id,operator_id,kind,user_id,provider_message_id,body,event_at,received_at,state) SELECT ?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM line_unsends WHERE connection_id=? AND provider_message_id=?) THEN NULL ELSE ? END,?,?,?",c.id,event.webhookEventId,c.operator_id,String(event.type||'unsupported').slice(0,40),user,mid,c.id,mid,supported?event.message.text:null,event.timestamp,time,supported?'pending':event.type==='unsend'?'processed':'unsupported'));
 }
 if(commands.length)await env.DB.batch(commands);
 return Response.json({accepted:true});
}
export async function processInbox(env:Env,operatorId?:string){
 const rows=(await stmt(env,"SELECT * FROM line_events WHERE state='pending'"+(operatorId?' AND operator_id=?':'')+' ORDER BY event_at,event_id LIMIT 50',...(operatorId?[operatorId]:[])).all<Row>()).results;
 for(const row of rows){
  const linked=await stmt(env,'SELECT conversation_id FROM line_contacts WHERE operator_id=? AND connection_id=? AND user_id=?',row.operator_id,row.connection_id,row.user_id).first<Row>();
  if(!linked?.conversation_id){await stmt(env,"UPDATE line_events SET state='unmatched' WHERE connection_id=? AND event_id=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM line_contacts WHERE connection_id=? AND user_id=? AND conversation_id IS NOT NULL)",row.connection_id,row.event_id,row.connection_id,row.user_id).run();continue;}
  const time=new Date(row.event_at).toISOString();
  const removed=await stmt(env,'SELECT 1 FROM line_unsends WHERE connection_id=? AND provider_message_id=?',row.connection_id,row.provider_message_id).first();
  await env.DB.batch([
   // Check tombstone again inside SQL; an unsend may arrive after the preceding read.
   stmt(env,"INSERT OR IGNORE INTO messages(id,operator_id,conversation_id,direction,body,source,status,idempotency_key,created_at,updated_at,connection_id,provider_message_id) SELECT ?,?,?,'in',CASE WHEN EXISTS(SELECT 1 FROM line_unsends WHERE connection_id=? AND provider_message_id=?) THEN '' ELSE ? END,'customer',CASE WHEN EXISTS(SELECT 1 FROM line_unsends WHERE connection_id=? AND provider_message_id=?) THEN 'removed' ELSE ? END,?,?,?,?,?",uid(),row.operator_id,linked.conversation_id,row.connection_id,row.provider_message_id,row.body||'',row.connection_id,row.provider_message_id,removed?'removed':'received','line:'+row.event_id,time,now(),row.connection_id,row.provider_message_id),
   stmt(env,"UPDATE line_events SET state='processed' WHERE connection_id=? AND event_id=?",row.connection_id,row.event_id)
  ]);
 }
 return rows.length;
}
export async function integrationStatus(env:Env,a:Actor){
 if(a.role!=='operator_owner')fail(403,'沒有此操作權限');
 const connections=(await stmt(env,'SELECT c.id,c.provider_id,c.channel_id,c.enabled,(SELECT MAX(received_at) FROM line_events e WHERE e.connection_id=c.id) AS last_received FROM line_connections c WHERE c.operator_id=?',a.operator_id).all<Row>()).results;
 return {line:connections.map(c=>({id:c.id,provider_id:c.provider_id,channel_id:c.channel_id,enabled:!!c.enabled,signature_configured:!!secrets(env,c.id).channelSecret,send_configured:!!secrets(env,c.id).channelAccessToken,send_enabled:!!c.enabled&&sendEnabled(env)&&!!secrets(env,c.id).channelAccessToken,last_received:c.last_received})),
  inbox_pending:(await stmt(env,"SELECT COUNT(*) n FROM line_events WHERE operator_id=? AND state IN('pending','unmatched')",a.operator_id).first<Row>())?.n||0,
  outbox:(await stmt(env,'SELECT state,COUNT(*) AS count FROM line_outbox WHERE operator_id=? GROUP BY state',a.operator_id).all()).results,
  payment:'not_connected',ai:'not_enabled'};
}
export async function inbox(env:Env,a:Actor){
 if(a.role!=='operator_owner')fail(403,'沒有此操作權限');
 return (await stmt(env,"SELECT c.id,c.connection_id,c.conversation_id,(SELECT COUNT(*) FROM line_events e WHERE e.connection_id=c.connection_id AND e.user_id=c.user_id AND e.kind='message') AS message_count,(SELECT e.body FROM line_events e WHERE e.connection_id=c.connection_id AND e.user_id=c.user_id AND e.kind='message' ORDER BY e.event_at DESC,e.event_id DESC LIMIT 1) AS preview FROM line_contacts c WHERE c.operator_id=? AND c.conversation_id IS NULL ORDER BY c.created_at DESC LIMIT 100",a.operator_id).all()).results;
}
export async function attachContact(env:Env,a:Actor,id:string,conversationId:string){
 if(a.role!=='operator_owner')fail(403,'沒有此操作權限');
 const contact=await stmt(env,'SELECT * FROM line_contacts WHERE id=? AND operator_id=?',id,a.operator_id).first<Row>();
 const conv=await stmt(env,'SELECT * FROM conversations WHERE id=? AND operator_id=?',conversationId,a.operator_id).first<Row>();
 if(!contact||!conv)fail(404,'找不到可分派的來客或對話');
 if(contact.conversation_id&&contact.conversation_id!==conversationId)fail(409,'來客已綁定其他對話');
 const occupied=await stmt(env,'SELECT id FROM line_contacts WHERE conversation_id=? AND id<>?',conversationId,id).first();
 if(occupied)fail(409,'對話已有 LINE 來客，請另建案件');
 const changes=await env.DB.batch([
  stmt(env,'UPDATE line_contacts SET conversation_id=? WHERE id=? AND operator_id=? AND conversation_id IS NULL',conversationId,id,a.operator_id),
  audit(env,a,conv.business_id,conv.opportunity_id,'line_contact_linked',{contact_id:id,connection_id:contact.connection_id},true),
  stmt(env,"UPDATE line_events SET state='pending' WHERE operator_id=? AND connection_id=? AND user_id=? AND state='unmatched' AND EXISTS(SELECT 1 FROM line_contacts WHERE id=? AND conversation_id=?)",a.operator_id,contact.connection_id,contact.user_id,id,conversationId)
 ]);
 const saved=await stmt(env,'SELECT conversation_id FROM line_contacts WHERE id=?',id).first<Row>();
 if(saved?.conversation_id!==conversationId)fail(409,'來客已由其他人分派');
 await processInbox(env,a.operator_id);return {ok:true,changed:!!changes[0].meta.changes};
}
export async function lineLink(env:Env,operatorId:string,conversationId:string){
 return stmt(env,'SELECT l.*,c.enabled FROM line_contacts l JOIN line_connections c ON c.id=l.connection_id AND c.operator_id=l.operator_id WHERE l.operator_id=? AND l.conversation_id=?',operatorId,conversationId).first<Row>();
}
export async function enqueueLine(env:Env,a:Actor,conversation:Row,text:string,key:string){
 const link=await lineLink(env,a.operator_id,conversation.id);
 if(!link||!link.enabled||!sendEnabled(env)||!secrets(env,link.connection_id).channelAccessToken)fail(503,'LINE 發送尚未啟用；未建立外送訊息');
 const old=await stmt(env,'SELECT id,body,status,actor_id FROM messages WHERE operator_id=? AND conversation_id=? AND idempotency_key=?',a.operator_id,conversation.id,key).first<Row>();
 if(old){if(old.body!==text||old.actor_id!==a.id)fail(409,'識別碼已用於其他訊息');return old;}
 const id=uid(),time=now();
 await env.DB.batch([
  stmt(env,"INSERT OR IGNORE INTO messages(id,operator_id,conversation_id,actor_id,direction,body,source,status,idempotency_key,created_at,updated_at,connection_id) VALUES(?,?,?,?,'out',?,'human','queued',?,?,?,?)",id,a.operator_id,conversation.id,a.id,text,key,time,time,link.connection_id),
  audit(env,a,conversation.business_id,conversation.opportunity_id,'line_message_queued',{message_id:id},true),
  stmt(env,"INSERT OR IGNORE INTO line_outbox(id,operator_id,connection_id,recipient,retry_key,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=?)",id,a.operator_id,link.connection_id,link.user_id,uid(),time,id)
 ]);
 const saved=await stmt(env,'SELECT id,body,status,actor_id FROM messages WHERE operator_id=? AND conversation_id=? AND idempotency_key=?',a.operator_id,conversation.id,key).first<Row>();
 if(saved?.body!==text||saved?.actor_id!==a.id)fail(409,'識別碼衝突');return saved;
}
async function sendPermission(env:Env,row:Row){
 const r=await stmt(env,'SELECT u.active,u.role,o.owner_id,b.service_owner_id FROM messages m JOIN staff_users u ON u.id=m.actor_id AND u.operator_id=m.operator_id JOIN conversations c ON c.id=m.conversation_id AND c.operator_id=m.operator_id JOIN opportunities o ON o.id=c.opportunity_id AND o.operator_id=c.operator_id JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id WHERE m.id=? AND m.operator_id=?',row.id,row.operator_id).first<Row>();
 return !!r?.active&&(r.role==='operator_owner'||r.role==='operator_sales'&&r.owner_id===row.actor_id||r.role==='operator_service'&&r.service_owner_id===row.actor_id);
}
export async function dispatchOutbox(env:Env,operatorId?:string){
 if(!sendEnabled(env))return {processed:0,disabled:true};
 const time=Date.now();
 const due=(await stmt(env,"SELECT q.*,m.actor_id,m.body,m.conversation_id FROM line_outbox q JOIN messages m ON m.id=q.id WHERE "+(operatorId?'q.operator_id=? AND ':'')+"((q.state IN('queued','retry','unknown') AND q.next_attempt_at<=?) OR (q.state='sending' AND q.lease_until<?)) ORDER BY q.created_at LIMIT 20",...(operatorId?[operatorId]:[]),time,time).all<Row>()).results;
 let processed=0;
 for(const row of due){
  const lease=uid();
  const claimed=await stmt(env,"UPDATE line_outbox SET state='sending',lease_token=?,lease_until=? WHERE id=? AND operator_id=? AND ((state IN('queued','retry','unknown') AND next_attempt_at<=?) OR (state='sending' AND lease_until<?))",lease,time+60000,row.id,row.operator_id,time,time).run();
  if(!claimed.meta.changes)continue;
  async function finish(state:string,status:string,error:string|null,requestId:string|null=null,next=0){
   // Every mutation is fenced by this worker's lease; late network results cannot overwrite a newer attempt.
   await env.DB.batch([
    stmt(env,'UPDATE messages SET status=?,updated_at=? WHERE id=? AND operator_id=? AND EXISTS(SELECT 1 FROM line_outbox WHERE id=? AND lease_token=?)',status,now(),row.id,row.operator_id,row.id,lease),
    stmt(env,"UPDATE conversations SET first_agent_id=COALESCE(first_agent_id,?) WHERE id=? AND operator_id=? AND ?='accepted' AND EXISTS(SELECT 1 FROM line_outbox WHERE id=? AND lease_token=?)",row.actor_id,row.conversation_id,row.operator_id,state,row.id,lease),
    stmt(env,'UPDATE line_outbox SET state=?,last_error=?,provider_request_id=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',state,error,requestId,next,row.id,lease)
   ]);
  }
  if(row.first_attempt_at&&time-row.first_attempt_at>=23*3600000||row.attempts>=5){await finish('needs_review','unknown','retry_window_or_attempt_limit');continue;}
  const c=await connection(env,row.connection_id);const token=secrets(env,row.connection_id).channelAccessToken;
  if(!c?.enabled||c.operator_id!==row.operator_id||!token||!await sendPermission(env,row)){await finish('blocked','blocked','configuration_or_authorization_changed');continue;}
  const latestLink=await lineLink(env,row.operator_id,row.conversation_id);
  if(latestLink?.connection_id!==row.connection_id||latestLink?.user_id!==row.recipient){await finish('blocked','blocked','recipient_binding_changed');continue;}
  await env.DB.batch([
   stmt(env,'UPDATE line_outbox SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=? AND lease_token=?',time,row.id,lease),
   stmt(env,"UPDATE messages SET status='sending',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM line_outbox WHERE id=? AND lease_token=?)",now(),row.id,row.id,lease)
  ]);
  const next=time+Math.min(3600000,30000*2**row.attempts);
  try{
   const response=await (env.HTTP||fetch)('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Line-Retry-Key':row.retry_key},body:JSON.stringify({to:row.recipient,messages:[{type:'text',text:row.body}]}),signal:AbortSignal.timeout(10000),redirect:'error'});
   const requestId=response.headers.get('x-line-request-id');
   if(response.ok)await finish('accepted','accepted',null,requestId);
   else if(response.status===409&&response.headers.get('x-line-accepted-request-id'))await finish('accepted','accepted',null,response.headers.get('x-line-accepted-request-id'));
   else if(response.status===429||response.status>=500)await finish('retry','unknown','provider_'+response.status,requestId,next);
   else await finish('failed','failed','provider_'+response.status,requestId);
   await response.body?.cancel();
  }catch{await finish('unknown','unknown','network_result_unknown',null,next);}
  processed++;
 }
 return {processed,disabled:false};
}
export async function retryLine(env:Env,a:Actor,id:string){
 const row=await stmt(env,'SELECT q.*,m.actor_id FROM line_outbox q JOIN messages m ON m.id=q.id WHERE q.id=? AND q.operator_id=?',id,a.operator_id).first<Row>();
 if(!row)fail(404,'找不到外送訊息');
 if(row.actor_id!==a.id)fail(403,'請原操作者重試');
 if(row.state==='accepted')return {id,status:'accepted'};
 if(!['failed','unknown','retry'].includes(row.state)||row.attempts>=5||row.first_attempt_at&&Date.now()-row.first_attempt_at>=23*3600000)fail(409,'此訊息不可重試，請管理員核查狀態');
 const r=await env.DB.batch([
  stmt(env,"UPDATE line_outbox SET state='queued',next_attempt_at=0,last_error=NULL WHERE id=? AND operator_id=? AND state IN('failed','unknown','retry')",id,a.operator_id),
  stmt(env,"UPDATE messages SET status='queued',updated_at=? WHERE id=? AND operator_id=? AND EXISTS(SELECT 1 FROM line_outbox WHERE id=? AND state='queued')",now(),id,a.operator_id,id)
 ]);
 return {id,status:r[0].meta.changes?'queued':row.state};
}

export async function conversationLineStatus(env:Env,a:Actor,id:string){
 const link=await lineLink(env,a.operator_id,id);
 return {bound:!!link,send_enabled:!!link?.enabled&&sendEnabled(env)&&!!secrets(env,link?.connection_id||'').channelAccessToken,connection_id:link?.connection_id||null};
}
