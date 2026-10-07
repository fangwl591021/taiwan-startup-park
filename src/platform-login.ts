import type {Actor,Env} from './types.js';
import {platformAccess} from './platform.js';
import {stmt,fail,uid,now} from './shared.js';
import {credentialStorageReady,encryptLineSecret,decryptStoredSecret} from './line-credentials.js';
const namespace='__platform_line_login__';
type Settings={provider_id:string;channel_id:string;encrypted_secret:string;version:number;updated_at:string};
export async function platformLoginRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 if(new URL(req.url).pathname!=='/api/platform/line-login')return null;
 if(!await platformAccess(env,a))fail(403,'僅系統總管理員可設定 LINE Login');
 const settings=await stmt(env,'SELECT provider_id,channel_id,encrypted_secret,version,updated_at FROM platform_line_login WHERE id=1').first<Settings>();
 if(!settings)fail(503,'LINE Login 設定結構尚未就緒');
 if(req.method==='GET'){
  const secret=await decryptStoredSecret(env,namespace,'login:'+settings.channel_id,settings.encrypted_secret);
  return Response.json({provider_id:settings.provider_id,channel_id:settings.channel_id,version:settings.version,updated_at:settings.updated_at,
   storage_ready:env.APP_ENV!=='sandbox'&&credentialStorageReady(env),simulation:env.APP_ENV==='sandbox',secret_stored:!!settings.encrypted_secret,secret_configured:!!secret.channelSecret,
   callback_url:(env.APP_ORIGIN||new URL(req.url).origin)+'/api/auth/line/callback',callback_active:false,scopes:['openid','profile'],status:'not_enabled',login_enabled:false});
 }
 if(req.method!=='PATCH')fail(404,'LINE Login 操作不存在');
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>3000)fail(413,'內容過長');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail(400,'請提供物件');
 const d=parsed as Record<string,unknown>;
 if(Object.keys(d).some(k=>!['provider_id','channel_id','channel_secret','version','reference'].includes(k)))fail(400,'包含不允許的欄位');
 for(const k of ['provider_id','channel_id'])if(typeof d[k]!=='string'||!/^\d{0,20}$/.test(d[k] as string))fail(400,'Login Channel／Provider ID 格式不正確');
 if(!Number.isSafeInteger(d.version)||Number(d.version)<1||typeof d.reference!=='string'||!d.reference.trim()||d.reference.length>500)fail(400,'版本或更新依據格式不正確');
 if(d.channel_secret!==undefined&&(typeof d.channel_secret!=='string'||!/^[A-Za-z0-9]{32}$/.test(d.channel_secret)))fail(400,'LINE Login Channel secret 格式不正確');
 if(d.channel_secret&&(!d.channel_id||env.APP_ENV==='sandbox'||!credentialStorageReady(env)))fail(env.APP_ENV==='sandbox'?409:503,'此環境不保存真實登入密鑰；請使用已就緒的正式系統後台');
 // Empty secret means retain only for the SAME Login channel. Changing the ID
 // clears a previous secret rather than silently pairing different channels.
 const encrypted=d.channel_secret?await encryptLineSecret(env,namespace,'login:'+d.channel_id,{channelSecret:d.channel_secret as string}):d.channel_id===settings.channel_id?settings.encrypted_secret:'';
 const at=now();
 const results=await env.DB.batch([
  stmt(env,'UPDATE platform_line_login SET provider_id=?,channel_id=?,encrypted_secret=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=?',d.provider_id,d.channel_id,encrypted,at,a.id,d.version),
  stmt(env,"INSERT INTO platform_activity(id,actor_id,action,detail,created_at) SELECT ?,?,'platform_line_login_updated',?,? WHERE changes()>0",uid(),a.id,JSON.stringify({reference:d.reference.trim(),secret_replaced:!!d.channel_secret,channel_changed:d.channel_id!==settings.channel_id}),at)
 ]);
 if(!results[0].meta.changes)fail(409,'LINE Login 設定已更新，請重新整理');
 return Response.json({ok:true,login_enabled:false,status:'not_enabled'});
}
