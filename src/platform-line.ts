import type {Actor,Env} from './types.js';
import {platformAccess} from './platform.js';
import {stmt,fail,uid,now} from './shared.js';
import {credentialStorageReady,encryptLineSecret,decryptStoredSecret} from './line-credentials.js';
const loginNamespace='__platform_line_login__',messagingNamespace='__platform_messaging__';
type Account={oa_name:string;basic_id:string;messaging_channel_id:string;messaging_provider_id:string;encrypted_messaging:string;webhook_key:string;version:number;updated_at:string};
type Login={provider_id:string;channel_id:string;encrypted_secret:string;version:number};
export async function platformLineRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 if(new URL(req.url).pathname!=='/api/platform/line-account')return null;
 if(!await platformAccess(env,a))fail(403,'僅系統總管理員可設定平台 LINE 帳號');
 const account=await stmt(env,'SELECT * FROM platform_line_account WHERE id=1').first<Account>();
 const login=await stmt(env,'SELECT provider_id,channel_id,encrypted_secret,version FROM platform_line_login WHERE id=1').first<Login>();
 const planning=await stmt(env,'SELECT version FROM platform_settings WHERE id=1').first<{version:number}>();
 if(!account||!login||!planning)fail(503,'LINE 設定結構尚未就緒');
 const messaging=await decryptStoredSecret(env,messagingNamespace,'messaging:'+account.messaging_channel_id,account.encrypted_messaging);
 if(req.method==='GET'){
  const secret=await decryptStoredSecret(env,loginNamespace,'login:'+login.channel_id,login.encrypted_secret);
  const origin=env.APP_ORIGIN||new URL(req.url).origin;
  return Response.json({oa_name:account.oa_name,basic_id:account.basic_id,login_channel_id:login.channel_id,login_provider_id:login.provider_id,
   messaging_channel_id:account.messaging_channel_id,messaging_provider_id:account.messaging_provider_id,
   version:account.version,login_version:login.version,planning_version:planning.version,updated_at:account.updated_at,
   storage_ready:env.APP_ENV!=='sandbox'&&credentialStorageReady(env),simulation:env.APP_ENV==='sandbox',
   has_login_secret:!!secret.channelSecret,has_messaging_secret:!!messaging.channelSecret,has_messaging_token:!!messaging.channelAccessToken,
   unreadable_credentials:!!((login.encrypted_secret&&!secret.channelSecret)||(account.encrypted_messaging&&!messaging.channelSecret&&!messaging.channelAccessToken)),
   callback_url:origin+'/api/auth/line/callback',webhook_url:origin+'/api/line/webhook/'+account.webhook_key,
   login_enabled:false,webhook_enabled:false,push_enabled:false});
 }
 if(req.method!=='PATCH')fail(404,'LINE 帳號操作不存在');
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>10000)fail(413,'內容過長');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail(400,'請提供物件');
 const d=parsed as Record<string,unknown>;
 const keys=['oa_name','basic_id','login_channel_id','login_provider_id','messaging_channel_id','messaging_provider_id','login_channel_secret','messaging_channel_secret','messaging_access_token','version','login_version','planning_version','reference'];
 if(Object.keys(d).some(k=>!keys.includes(k)))fail(400,'包含不允許的欄位');
 for(const k of ['login_channel_id','login_provider_id','messaging_channel_id','messaging_provider_id'])if(typeof d[k]!=='string'||!/^\d{0,20}$/.test(d[k] as string))fail(400,'Channel／Provider ID 請填數字');
 if(typeof d.oa_name!=='string'||d.oa_name.length>100||typeof d.basic_id!=='string'||!/^(@[A-Za-z0-9._-]{1,100})?$/.test(d.basic_id))fail(400,'OA 名稱或 @帳號格式不正確');
 for(const k of ['version','login_version','planning_version'])if(!Number.isSafeInteger(d[k])||Number(d[k])<1)fail(400,'版本格式不正確');
 if(typeof d.reference!=='string'||!d.reference.trim()||d.reference.length>500)fail(400,'請填設定／更新依據');
 for(const k of ['login_channel_secret','messaging_channel_secret'])if(d[k]!==undefined&&(typeof d[k]!=='string'||!/^([A-Za-z0-9]{32})?$/.test(d[k] as string)))fail(400,'Channel secret 請填 32 個英數字');
 if(d.messaging_access_token!==undefined&&(typeof d.messaging_access_token!=='string'||!/^([\x21-\x7e]{20,5000})?$/.test(d.messaging_access_token)))fail(400,'Messaging API Token 格式不正確');
 const secretKeys=['login_channel_secret','messaging_channel_secret','messaging_access_token'];
 if(secretKeys.some(k=>!!d[k])&&(env.APP_ENV==='sandbox'||!credentialStorageReady(env)))fail(env.APP_ENV==='sandbox'?409:503,'此環境不保存真實憑證；請使用正式系統後台');
 if(d.login_channel_secret&&!d.login_channel_id||(d.messaging_channel_secret||d.messaging_access_token)&&!d.messaging_channel_id)fail(400,'請先填對應的 Channel ID');
 const loginChanged=d.login_channel_id!==login.channel_id,messagingChanged=d.messaging_channel_id!==account.messaging_channel_id;
 // Replacing an identity never retains credentials from a different channel.
 const loginCipher=d.login_channel_secret?await encryptLineSecret(env,loginNamespace,'login:'+d.login_channel_id,{channelSecret:d.login_channel_secret as string}):loginChanged?'':login.encrypted_secret;
 let messagingCipher=messagingChanged?'':account.encrypted_messaging;
 if(d.messaging_channel_secret||d.messaging_access_token){
  if(!messagingChanged&&account.encrypted_messaging&&!messaging.channelSecret&&!messaging.channelAccessToken)fail(409,'既有憑證無法讀取，請重新提供訊息密鑰與權杖');
  messagingCipher=await encryptLineSecret(env,messagingNamespace,'messaging:'+d.messaging_channel_id,{
   channelSecret:(d.messaging_channel_secret||(messagingChanged?'':messaging.channelSecret)||'') as string,
   channelAccessToken:(d.messaging_access_token||(messagingChanged?'':messaging.channelAccessToken)||'') as string});
 }
 const at=now();
 // A single transaction: stale versions save neither family nor their audit.
 const result=await env.DB.batch([
  stmt(env,'UPDATE platform_line_account SET oa_name=?,basic_id=?,messaging_channel_id=?,messaging_provider_id=?,encrypted_messaging=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=? AND (SELECT version FROM platform_line_login WHERE id=1)=? AND (SELECT version FROM platform_settings WHERE id=1)=?',d.oa_name.trim(),d.basic_id,d.messaging_channel_id,d.messaging_provider_id,messagingCipher,at,a.id,d.version,d.login_version,d.planning_version),
  stmt(env,'UPDATE platform_line_login SET provider_id=?,channel_id=?,encrypted_secret=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND changes()>0',d.login_provider_id,d.login_channel_id,loginCipher,at,a.id),
  stmt(env,'UPDATE platform_settings SET oa_name=?,provider_id=?,channel_id=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND changes()>0',d.oa_name.trim(),d.messaging_provider_id,d.messaging_channel_id,at,a.id),
  stmt(env,"INSERT INTO platform_activity(id,actor_id,action,detail,created_at) SELECT ?,?,'platform_line_account_updated',?,? WHERE changes()>0",uid(),a.id,JSON.stringify({reference:d.reference.trim(),login_channel_changed:loginChanged,messaging_channel_changed:messagingChanged,credentials_replaced:secretKeys.filter(k=>!!d[k])}),at)
 ]);
 if(!result[0].meta.changes)fail(409,'LINE 設定已更新，請重新整理後再保存');
 return Response.json({ok:true,login_enabled:false,webhook_enabled:false,push_enabled:false});
}
