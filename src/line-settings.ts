import type {Actor,Env} from './types.js';
import {stmt,fail,uid,now,audit} from './shared.js';
import {credentialStorageReady,encryptLineSecret,lineSecret} from './line-credentials.js';
type Row=Record<string,any>;
const json=(v:unknown,status=200)=>Response.json(v,{status});
const owner=(a:Actor)=>{if(a.role!=='operator_owner')fail(403,'只有總管理員可管理業者 LINE OA');};
const ready=(env:Env)=>credentialStorageReady(env)&&['local','staging','production'].includes(env.APP_ENV||'');
function writeReady(env:Env){if(env.APP_ENV==='sandbox')fail(409,'測試區不保存真實 LINE 憑證，請到正式工作台設定');if(!ready(env))fail(503,'安全憑證保存尚未就緒，請聯絡平台管理員');}
function field(v:unknown,label:string,max=100){if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,label+'格式不正確');return (v as string).trim();}
function ver(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)fail(400,'版本格式不正確');return v as number;}
async function body(req:Request,keys:string[]){
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>14000)fail(413,'內容過長');
 let d:Row;try{d=JSON.parse(raw);}catch{return fail(400,'JSON 格式錯誤');}
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!keys.includes(k)))fail(400,'包含不允許的欄位');return d;
}
async function current(env:Env,a:Actor,id:string){
 const c=await stmt(env,'SELECT * FROM line_connections WHERE id=? AND operator_id=?',id,a.operator_id).first<Row>();
 if(!c)fail(404,'找不到可設定的業者 OA');return c;
}
function secretField(v:unknown){const s=field(v,'Channel secret',64);if(!/^[a-f0-9]{32}$/i.test(s))fail(400,'Channel secret 應為 LINE 提供的 32 位字元');return s;}
function tokenField(v:unknown){const s=field(v,'Channel access token',5000);if(s.length<20||!/^[!-~]+$/.test(s))fail(400,'Channel access token 格式不正確');return s;}
async function readLine(env:Env,url:string,options:RequestInit){
 let r:Response;
 try{r=await (env.HTTP||fetch)(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});}catch{return fail(502,'LINE 連線驗證暫時失敗，請稍後重試');}
 if(!r.ok){if([400,401,403].includes(r.status))fail(400,'LINE 憑證無效或已過期，請重新確認');fail(502,'LINE 連線驗證暫時失敗（HTTP '+r.status+'）');}
 try{return await r.json() as Row;}catch{return fail(502,'LINE 驗證回應格式不正確');}
}
async function verifyBot(env:Env,channel:string,token:string){
 // Deliberately limited to the long-/short-lived token API. No push or broadcast.
 const proof=await readLine(env,'https://api.line.me/v2/oauth/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:token}).toString()});
 if(String(proof.client_id)!==channel)fail(400,'Channel ID 與這組 access token 不一致');
 const bot=await readLine(env,'https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+token}});
 if(typeof bot.userId!=='string'||!/^U[0-9a-f]{32}$/.test(bot.userId))fail(502,'LINE OA 識別資料不完整');
 return {destination:bot.userId,name:typeof bot.displayName==='string'?bot.displayName.slice(0,100):'業者 LINE OA'};
}
export async function lineSettingsState(req:Request,env:Env,a:Actor){
 owner(a);
 const rows=(await stmt(env,'SELECT id,provider_id,channel_id,name,enabled,version,updated_at,verified_at,last_webhook_at FROM line_connections WHERE operator_id=? ORDER BY name,id LIMIT 50',a.operator_id).all<Row>()).results;
 const connections=await Promise.all(rows.map(async c=>{
  const s=await lineSecret(env,c.id);
  return {...c,enabled:!!c.enabled,signature_configured:!!s.channelSecret,token_configured:!!s.channelAccessToken,
   webhook_url:env.APP_ENV==='sandbox'?null:(env.APP_ORIGIN||new URL(req.url).origin)+'/api/line/webhook/'+c.id};
 }));
 return {storage_ready:ready(env),simulation:env.APP_ENV==='sandbox',connections,push_enabled:false,mail_push_enabled:false,
  note:env.APP_ENV==='sandbox'?'測試區僅展示操作，不保存真實 LINE 憑證。':'設定只開放接收；工作聊天室外送與郵件推播維持未啟用。'};
}
export async function lineSettingsRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const match=new URL(req.url).pathname.match(/^\/api\/line\/settings(?:\/([a-zA-Z0-9_-]+))?(?:\/(check|status))?$/);
 if(!match)return null;owner(a);const [,id,action]=match,method=req.method;
 if(method==='GET'&&!id)return json(await lineSettingsState(req,env,a));
 if(method==='GET'||!['POST','PATCH'].includes(method))fail(404,'找不到此設定操作');
 writeReady(env);
 if(!id&&method==='POST'){
  const d=await body(req,['name','provider_id','channel_id','channel_secret','channel_access_token','reference']);
  const name=field(d.name,'OA 名稱'),provider=field(d.provider_id,'Provider ID',20),channel=field(d.channel_id,'Channel ID',20),reference=field(d.reference,'設定依據',500);
  if(!/^\d{1,20}$/.test(provider)||!/^\d{1,20}$/.test(channel))fail(400,'Provider ID 與 Channel ID 應為數字');
  const secret=secretField(d.channel_secret),token=tokenField(d.channel_access_token);
  if(await stmt(env,'SELECT id FROM line_connections WHERE channel_id=?',channel).first())fail(409,'此 Channel 已設定，請管理既有連線');
  const bot=await verifyBot(env,channel,token),cid=uid(),time=now();
  const encrypted=await encryptLineSecret(env,a.operator_id,cid,{channelSecret:secret,channelAccessToken:token});
  const result=await env.DB.batch([
   stmt(env,'INSERT OR IGNORE INTO line_connections(id,operator_id,provider_id,channel_id,destination,enabled,name,updated_at,verified_at) VALUES(?,?,?,?,?,1,?,?,?)',cid,a.operator_id,provider,channel,bot.destination,name,time,time),
   stmt(env,'INSERT INTO line_connection_secrets(connection_id,operator_id,encrypted_value,updated_at) SELECT ?,?,?,? WHERE changes()>0',cid,a.operator_id,encrypted,time),
   audit(env,a,null,null,'line_connection_configured',{connection_id:cid,name,reference,receive_enabled:true,push_enabled:false},true)
  ]);
  if(!result[0].meta.changes)fail(409,'此 Channel 或 OA 已設定，請管理既有連線');
  return json(await lineSettingsState(req,env,a),201);
 }
 if(!id)fail(404,'找不到此設定操作');
 const c=await current(env,a,id);
 if(action==='status'&&method==='PATCH'){
  const d=await body(req,['version','enabled','reference']),v=ver(d.version),reference=field(d.reference,'操作依據',500);
  if(typeof d.enabled!=='boolean')fail(400,'接收開關格式不正確');
  if(v!==c.version)fail(409,'設定已更新，請重新整理');
  if(d.enabled&&!(await lineSecret(env,id)).channelSecret)fail(409,'缺少可用驗簽憑證，不能啟用接收');
  const r=await env.DB.batch([stmt(env,'UPDATE line_connections SET enabled=?,version=version+1,updated_at=? WHERE id=? AND operator_id=? AND version=?',d.enabled?1:0,now(),id,a.operator_id,v),audit(env,a,null,null,'line_connection_status_changed',{connection_id:id,enabled:d.enabled,reference,push_enabled:false},true)]);
  if(!r[0].meta.changes)fail(409,'設定已更新，請重新整理');
  return json(await lineSettingsState(req,env,a));
 }
 if(action==='check'&&method==='POST'){
  const d=await body(req,['version']),v=ver(d.version);if(v!==c.version)fail(409,'設定已更新，請重新整理');
  const s=await lineSecret(env,id);if(!s.channelAccessToken)fail(409,'缺少可用 access token，請更新憑證');
  const bot=await verifyBot(env,c.channel_id,s.channelAccessToken);if(bot.destination!==c.destination)fail(409,'OA 身分不一致，請另建正確連線');
  const r=await env.DB.batch([stmt(env,'UPDATE line_connections SET verified_at=?,version=version+1,updated_at=? WHERE id=? AND operator_id=? AND version=?',now(),now(),id,a.operator_id,v),audit(env,a,null,null,'line_connection_checked',{connection_id:id,result:'token_valid',webhook_verified:!!c.last_webhook_at,push_enabled:false},true)]);
  if(!r[0].meta.changes)fail(409,'設定已更新，請重新整理');return json(await lineSettingsState(req,env,a));
 }
 if(!action&&method==='PATCH'){
  const d=await body(req,['version','name','channel_secret','channel_access_token','reference']),v=ver(d.version),name=field(d.name,'OA 名稱'),reference=field(d.reference,'更新依據',500);
  if(v!==c.version)fail(409,'設定已更新，請重新整理');
  const old=await lineSecret(env,id),secret=d.channel_secret===undefined?old.channelSecret:secretField(d.channel_secret),token=d.channel_access_token===undefined?old.channelAccessToken:tokenField(d.channel_access_token);
  if(!secret||!token)fail(400,'請補上完整 Channel secret 與 access token');
  const bot=await verifyBot(env,c.channel_id,token);if(bot.destination!==c.destination)fail(409,'OA 身分不一致，請另建正確連線');
  const time=now(),encrypted=await encryptLineSecret(env,a.operator_id,id,{channelSecret:secret,channelAccessToken:token});
  const r=await env.DB.batch([
   stmt(env,'UPDATE line_connections SET name=?,version=version+1,updated_at=?,verified_at=?,last_webhook_at=CASE WHEN ? THEN NULL ELSE last_webhook_at END WHERE id=? AND operator_id=? AND version=?',name,time,time,d.channel_secret!==undefined?1:0,id,a.operator_id,v),
   stmt(env,'INSERT INTO line_connection_secrets(connection_id,operator_id,encrypted_value,updated_at) SELECT ?,?,?,? WHERE changes()>0 ON CONFLICT(connection_id) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at',id,a.operator_id,encrypted,time),
   audit(env,a,null,null,'line_connection_updated',{connection_id:id,name,reference,credentials_changed:d.channel_secret!==undefined||d.channel_access_token!==undefined,push_enabled:false},true)
  ]);
  if(!r[0].meta.changes)fail(409,'設定已更新，請重新整理');return json(await lineSettingsState(req,env,a));
 }
 return fail(404,'找不到此設定操作');
}
