import type {Env,Statement} from './types.js';
import {stmt,uid,digest} from './shared.js';
// Called only after verification of the original bytes and destination by receiveWebhook.
export async function groupEventStatements(env:Env,c:{id:string;operator_id:string},event:Record<string,any>):Promise<Statement[]>{
 const source=event.source,type=source?.type;
 if(!['group','room'].includes(type))return [];
 const sourceId=type==='group'?source.groupId:source.roomId;
 if(typeof sourceId!=='string'||!sourceId||sourceId.length>100)return [];
 const at=new Date(event.timestamp).toISOString();
 const commands=[stmt(env,`INSERT OR IGNORE INTO monitor_groups(id,operator_id,connection_id,source_type,source_id,name,created_at,last_event_at)
 VALUES(?,?,?,?,?,?,?,?)`,uid(),c.operator_id,c.id,type,sourceId,type==='group'?'新發現 LINE 群組':'新發現 LINE 多人聊天室',at,at)];
 commands.push(stmt(env,`UPDATE monitor_groups SET last_event_at=MAX(last_event_at,?),departed=CASE WHEN ?='leave' THEN 1 WHEN ?='join' THEN 0 ELSE departed END,
 enabled=CASE WHEN ?='leave' THEN 0 ELSE enabled END,version=version+CASE WHEN ?='leave' AND enabled=1 THEN 1 ELSE 0 END
 WHERE operator_id=? AND connection_id=? AND source_type=? AND source_id=? AND last_event_at<=?
 AND NOT EXISTS(SELECT 1 FROM line_events WHERE connection_id=? AND event_id=?)`,at,event.type,event.type,event.type,event.type,c.operator_id,c.id,type,sourceId,at,c.id,event.webhookEventId));
 if(event.type==='message'&&event.message?.type==='text'&&typeof event.message.text==='string'&&event.message.text.length<=5000&&typeof event.message.id==='string'&&event.message.id.length<=100){
  const member=typeof source.userId==='string'&&source.userId.length>0&&source.userId.length<=100?await digest(c.id+'\u0000'+source.userId):null;
  commands.push(stmt(env,`INSERT OR IGNORE INTO monitor_group_messages(id,operator_id,group_id,connection_id,event_id,provider_message_id,member_hash,body,removed,created_at)
 SELECT ?,g.operator_id,g.id,g.connection_id,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM line_unsends WHERE connection_id=? AND provider_message_id=?) THEN '' ELSE ? END,
 EXISTS(SELECT 1 FROM line_unsends WHERE connection_id=? AND provider_message_id=?),? FROM monitor_groups g
 WHERE g.operator_id=? AND g.connection_id=? AND g.source_type=? AND g.source_id=? AND g.enabled=1 AND g.departed=0
 AND EXISTS(SELECT 1 FROM workspace_modules w WHERE w.operator_id=g.operator_id AND w.module='monitor' AND w.enabled=1)
 AND NOT EXISTS(SELECT 1 FROM line_events WHERE connection_id=? AND event_id=?)`,uid(),event.webhookEventId,event.message.id,member,c.id,event.message.id,event.message.text,c.id,event.message.id,at,c.operator_id,c.id,type,sourceId,c.id,event.webhookEventId));
 }
 return commands;
}
