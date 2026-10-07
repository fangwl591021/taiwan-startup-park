import type {Env,Statement} from './types.js';
import {stmt,fail,now} from './shared.js';
import {decryptStoredSecret} from './line-credentials.js';
import {rawBody,verifyLineSignature} from './line.js';
type Account={webhook_key:string;messaging_channel_id:string;encrypted_messaging:string;destination:string;version:number};
type Row=Record<string,any>;
export async function receivePlatformWebhook(req:Request,env:Env,id:string){
 if(env.APP_ENV==='sandbox')fail(404,'測試環境不接收真實 LINE');
 const c=await stmt(env,'SELECT webhook_key,messaging_channel_id,encrypted_messaging,destination,version FROM platform_line_account WHERE id=1 AND webhook_key=?',id).first<Account>();
 if(!c)fail(404,'平台 Webhook 不存在');
 const secret=await decryptStoredSecret(env,'__platform_messaging__','messaging:'+c.messaging_channel_id,c.encrypted_messaging);
 if(!c.messaging_channel_id||!secret.channelSecret)fail(503,'請先保存 Messaging API Channel ID 與 LINE 訊息頻道密鑰（Channel Secret）');
 const bytes=await rawBody(req);
 if(!await verifyLineSignature(bytes,req.headers.get('x-line-signature')||'',secret.channelSecret))fail(401,'Webhook 簽章無效，請確認 LINE 訊息頻道密鑰');
 let payload:Row;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'Webhook 格式錯誤');}
 if(!payload!||typeof payload.destination!=='string'||!/^U[0-9a-f]{32}$/i.test(payload.destination)||!Array.isArray(payload.events)||payload.events.length>100)fail(400,'Webhook 帳號或事件格式錯誤');
 // Only a signature verified with this account's Messaging secret can establish
 // its bot destination. Login credentials and operator channels are never used.
 if(c.destination&&payload.destination!==c.destination)fail(400,'Webhook 帳號與既有驗簽帳號不符');
 for(const event of payload.events){
  if(!event||typeof event.type!=='string'||!event.type||event.type.length>40||typeof event.webhookEventId!=='string'||!event.webhookEventId||event.webhookEventId.length>100||!Number.isSafeInteger(event.timestamp)||event.timestamp<0||event.timestamp>8640000000000000)fail(400,'事件識別或時間錯誤');
  if(event.type==='message'&&event.message?.type==='text'&&(typeof event.message.text!=='string'||event.message.text.length>5000||typeof event.message.id!=='string'||event.message.id.length>100))fail(400,'文字訊息格式錯誤');
  if(event.type==='unsend'&&(typeof event.unsend?.messageId!=='string'||!event.unsend.messageId||event.unsend.messageId.length>100))fail(400,'收回事件格式錯誤');
 }
 const at=now(),guard='EXISTS(SELECT 1 FROM platform_line_account WHERE id=1 AND webhook_key=? AND messaging_channel_id=? AND version=? AND encrypted_messaging=? AND destination=?)';
 const args=[id,c.messaging_channel_id,c.version,c.encrypted_messaging,payload.destination];
 const commands:Statement[]=[stmt(env,"UPDATE platform_line_account SET destination=?,last_webhook_at=? WHERE id=1 AND webhook_key=? AND messaging_channel_id=? AND version=? AND encrypted_messaging=? AND (destination='' OR destination=?)",payload.destination,at,...args)];
 // Tombstones precede all messages, including delayed delivery, and erase text.
 for(const event of payload.events)if(event.type==='unsend'){
  commands.push(stmt(env,'INSERT OR IGNORE INTO platform_line_unsends(channel_id,provider_message_id) SELECT ?,? WHERE '+guard,c.messaging_channel_id,event.unsend.messageId,...args));
  commands.push(stmt(env,'UPDATE platform_line_events SET body=NULL WHERE channel_id=? AND provider_message_id=? AND '+guard,c.messaging_channel_id,event.unsend.messageId,...args));
 }
 for(const event of payload.events){
  const mid=event.type==='unsend'?event.unsend.messageId:typeof event.message?.id==='string'?event.message.id.slice(0,100):null;
  const text=event.type==='message'&&event.message?.type==='text'?event.message.text:null;
  commands.push(stmt(env,'INSERT OR IGNORE INTO platform_line_events(channel_id,event_id,kind,source_type,user_id,provider_message_id,body,event_at,received_at) SELECT ?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM platform_line_unsends WHERE channel_id=? AND provider_message_id=?) THEN NULL ELSE ? END,?,? WHERE '+guard,c.messaging_channel_id,event.webhookEventId,event.type,String(event.source?.type||'').slice(0,20),typeof event.source?.userId==='string'?event.source.userId.slice(0,100):'',mid,c.messaging_channel_id,mid,text,event.timestamp,at,...args));
 }
 const result=await env.DB.batch(commands);
 if(!result[0].meta.changes)fail(409,'平台 LINE 設定已變更，請重新驗證');
 // Verify sends events:[]; it is a real signed request and must return HTTP 200.
 // Non-empty batches are acknowledged only AFTER durable atomic persistence.
 return Response.json({accepted:true});
}
