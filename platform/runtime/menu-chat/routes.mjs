import {credentialDatabase} from '../credentials.mjs';
import {privateAssetBucket} from '../private-assets.mjs';
import {handleRichMenuChat,processMenuRefresh} from './rich-menu-chat.mjs';
import {createRichMenuUploadRoutes} from './rich-menu-upload-routes.ts';
const json=(d,status=200)=>Response.json(d,{status});
async function input(req,max=2048){const text=await req.text();if(text.length>max)throw new Error('INPUT_TOO_LARGE');return JSON.parse(text);}
export async function menuChatRoute(req,env,c,path){
 if(!path.startsWith('/api/rich-menu-chat'))return null;
 const workspace=c.source_workspace_id,db=env.PLATFORM_DB;
 const account=await db.prepare('SELECT * FROM workspace_line_accounts WHERE workspace_id=? LIMIT 1').bind(workspace).first();
 if(!account)return json({success:false,error:'MENU_OPERATOR_ACCOUNT_REQUIRED'},409);
 const config=await db.prepare('SELECT * FROM startup_park_menu_chat_connections WHERE workspace_id=?').bind(workspace).first();
 const webhookUrl=config?new URL('/api/line/webhook/runtime/'+config.webhook_key,req.url).href:null;
 if(path==='/api/rich-menu-chat/connection'&&req.method==='GET')return json({success:true,enabled:account.webhook_enabled===1&&Boolean(config),webhookUrl,credentialsReady:Boolean(account.line_bot_channel_secret&&account.line_bot_channel_access_token),demo:env.DEMO_MODE==='on',liffId:config?.liff_id||'',liffEndpoint:new URL('/api/line/webhook/menu-upload/page',req.url).href});
 if(path==='/api/rich-menu-chat/liff'&&req.method==='PUT'){
  const b=await input(req,256);if(!config)return json({success:false,error:'請先啟用此工作區 LINE 連線'},409);
  if(!/^\d+-[A-Za-z0-9]{1,80}$/.test(b.liffId||'')||b.liffId.split('-')[0]!==account.line_login_channel_id||b.linkageConfirmed!==true||Object.keys(b).some(k=>!['liffId','linkageConfirmed'].includes(k)))return json({success:false,error:'請使用此工作區 LINE Login Channel 的 LIFF ID，並確認與 OA 同一 Provider'},400);
  await db.prepare('UPDATE startup_park_menu_chat_connections SET liff_id=? WHERE workspace_id=? AND line_account_id=?').bind(b.liffId,workspace,account.id).run();return json({success:true});
 }
 if(path==='/api/rich-menu-chat/connection'&&req.method==='PUT'){
  const body=await input(req,128);if(typeof body.enabled!=='boolean'||Object.keys(body).length!==1)return json({success:false,error:'設定格式錯誤'},400);
  if(body.enabled){
   if(env.DEMO_MODE==='on')return json({success:false,error:'展示環境不啟用 LINE 發布'},409);
   const own=await credentialDatabase(db,env,c.workspace.operator_id,workspace).prepare('SELECT * FROM workspace_line_accounts WHERE id=? AND workspace_id=?').bind(account.id,workspace).first();
   if(!own?.line_bot_channel_secret||!own.line_bot_channel_access_token)return json({success:false,error:'請先保存此工作區的 Messaging API Secret 與 Token'},409);
   const bot=await fetch('https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+own.line_bot_channel_access_token},signal:AbortSignal.timeout(8000)});
   if(!bot.ok)return json({success:false,error:'無法驗證此工作區的 LINE Token'},409);
   const identity=await bot.json();if(!/^U[a-f0-9]{32}$/.test(identity.userId||''))return json({success:false,error:'LINE 帳號驗證失敗'},409);
   await db.batch([db.prepare('INSERT INTO startup_park_menu_chat_connections(workspace_id,line_account_id,webhook_key,destination) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET destination=excluded.destination').bind(workspace,account.id,config?.webhook_key||crypto.randomUUID(),identity.userId),db.prepare("UPDATE workspace_line_accounts SET webhook_enabled=1,status='connected' WHERE id=? AND workspace_id=?").bind(account.id,workspace)]);
  }else await db.prepare("UPDATE workspace_line_accounts SET webhook_enabled=0,status='disconnected' WHERE id=? AND workspace_id=?").bind(account.id,workspace).run();
  return json({success:true});
 }
 if(path==='/api/rich-menu-chat/operators'&&req.method==='GET'){
  // Interrupted publishers require review; they must never be republished automatically.
  await db.batch([db.prepare("UPDATE rich_menu_chat_jobs SET phase='uncertain',error_code='JOB_INTERRUPTED' WHERE workspace_id=? AND phase IN ('checking','publishing') AND updated_at<datetime('now','-3 minutes')").bind(workspace),db.prepare("UPDATE rich_menu_chat_sessions SET phase='uncertain' WHERE workspace_id=? AND phase='busy' AND updated_at<datetime('now','-3 minutes')").bind(workspace)]);
  const operators=(await db.prepare('SELECT line_user_id uid,label,enabled,revision,updated_at updatedAt FROM rich_menu_chat_operators WHERE workspace_id=? AND line_account_id=? ORDER BY updated_at DESC').bind(workspace,account.id).all()).results;
  const jobs=(await db.prepare('SELECT j.id,p.name projectName,j.phase,j.error_code errorCode,j.notification_status notificationStatus,j.created_at createdAt FROM rich_menu_chat_jobs j LEFT JOIN projects p ON p.id=j.project_id AND p.workspace_id=j.workspace_id WHERE j.workspace_id=? AND j.line_account_id=? ORDER BY j.created_at DESC,j.id LIMIT 20').bind(workspace,account.id).all()).results;
  return json({success:true,configured:true,operators,jobs});
 }
 if(path==='/api/rich-menu-chat/operators'&&req.method==='PUT'){
  const b=await input(req);if(!b||Object.keys(b).some(k=>!['uid','label','enabled','revision'].includes(k))||!/^U[a-f0-9]{32}$/.test(b.uid)||typeof b.label!=='string'||b.label.length>80||typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.revision)||b.revision<0)return json({success:false,error:'MENU_OPERATOR_INPUT_INVALID'},400);
  const r=b.revision===0?await db.prepare('INSERT OR IGNORE INTO rich_menu_chat_operators(workspace_id,line_account_id,line_user_id,label,enabled,actor_id) VALUES(?,?,?,?,?,?)').bind(workspace,account.id,b.uid,b.label.trim(),+b.enabled,c.actor.id).run():await db.prepare('UPDATE rich_menu_chat_operators SET label=?,enabled=?,revision=revision+1,actor_id=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND revision=?').bind(b.label.trim(),+b.enabled,c.actor.id,workspace,account.id,b.uid,b.revision).run();
  return json(r.meta.changes?{success:true}:{success:false,error:'MENU_OPERATOR_STALE'},r.meta.changes?200:409);
 }
 const review=path.match(/^\/api\/rich-menu-chat\/operators\/jobs\/([a-zA-Z0-9_-]+)\/acknowledge$/);
 if(review&&req.method==='POST'){
  const b=await input(req,128);if(b.reviewed!==true||Object.keys(b).length!==1)return json({success:false,error:'MENU_REVIEW_REQUIRED'},400);
  const job=await db.prepare("SELECT * FROM rich_menu_chat_jobs WHERE id=? AND workspace_id=? AND line_account_id=? AND phase='uncertain'").bind(review[1],workspace,account.id).first();if(!job)return json({success:false,error:'MENU_OPERATOR_STALE'},409);
  await db.batch([db.prepare("UPDATE rich_menu_chat_jobs SET phase='acknowledged',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND phase='uncertain'").bind(job.id,workspace),db.prepare("UPDATE rich_menu_chat_sessions SET phase='failed',expires_at=0 WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND phase='uncertain' AND snapshot_json=?").bind(workspace,account.id,job.line_user_id,job.snapshot_json)]);return json({success:true});
 }
 if(path==='/api/rich-menu-chat/refresh'&&req.method==='POST'){
  if(env.DEMO_MODE==='on'||!account.webhook_enabled||!config)return json({success:false,error:'LINE 尚未啟用'},409);
  const own=await credentialDatabase(db,env,c.workspace.operator_id,workspace).prepare('SELECT * FROM workspace_line_accounts WHERE id=? AND workspace_id=?').bind(account.id,workspace).first();
  return json({success:true,result:await processMenuRefresh({smart_menu_db:db},own)});
 }
 return json({success:false,error:'找不到操作'},404);
}
export async function menuChatWebhook(req,env,ctx,key){
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(!env.PLATFORM_DB||env.DEMO_MODE==='on')return json({error:'Not found'},404);
 const db=env.PLATFORM_DB,config=await db.prepare('SELECT * FROM startup_park_menu_chat_connections WHERE webhook_key=?').bind(key).first();if(!config)return json({error:'Not found'},404);
 const authority=()=>env.DB.prepare("SELECT w.operator_id FROM platform_workspaces w JOIN operators o ON o.id=w.operator_id JOIN platform_workspace_entitlements e ON e.workspace_id=w.id AND e.module='CORE_MENU' AND e.enabled=1 WHERE w.source_workspace_id=? AND w.status='active' AND EXISTS(SELECT 1 FROM staff_users u WHERE u.operator_id=w.operator_id AND u.role='operator_owner' AND u.active=1) AND (w.scope_kind='operator' OR EXISTS(SELECT 1 FROM businesses b JOIN platform_business_members m ON m.business_id=b.id AND m.operator_id=b.operator_id JOIN staff_users u ON u.id=m.user_id AND u.active=1 AND u.role='business_admin' WHERE b.id=w.business_id AND b.operator_id=w.operator_id AND b.is_tenant=1 AND m.active=1))").bind(config.workspace_id).first();
 const scope=await authority();if(!scope)return json({error:'Not found'},404);
 const scopedDb={prepare:db.prepare.bind(db),batch:db.batch.bind(db),menuAuthority:async()=>Boolean(await authority())};
 const account=await credentialDatabase(db,env,scope.operator_id,config.workspace_id).prepare('SELECT * FROM workspace_line_accounts WHERE id=? AND workspace_id=? AND webhook_enabled=1').bind(config.line_account_id,config.workspace_id).first();if(!account?.line_bot_channel_secret||!account.line_bot_channel_access_token)return json({error:'Not found'},404);
 const signature=req.headers.get('x-line-signature');if(!signature)return json({error:'Invalid signature'},401);
 const reader=req.body?.getReader(),parts=[];let size=0;if(!reader)return json({error:'Invalid body'},400);while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>131072){await reader.cancel();return json({error:'Body too large'},413);}parts.push(p.value);}
 const raw=new Uint8Array(size);let at=0;for(const p of parts){raw.set(p,at);at+=p.length;}
 const secret=await crypto.subtle.importKey('raw',new TextEncoder().encode(account.line_bot_channel_secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 let bytes;try{bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));}catch{return json({error:'Invalid signature'},401);}
 if(!await crypto.subtle.verify('HMAC',secret,bytes,raw))return json({error:'Invalid signature'},401);
 let payload;try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'Invalid body'},400);}
 if(payload.destination!==config.destination||!Array.isArray(payload.events)||payload.events.length>100)return json({error:'Invalid destination or events'},400);
 const reply=async(token,body)=>{const r=await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('LINE_REPLY_FAILED');};
 for(const event of payload.events){
  if(!/^U[a-f0-9]{32}$/.test(event?.source?.userId||'')||!event.webhookEventId||typeof event.webhookEventId!=='string'||event.webhookEventId.length>120)continue;
  const r=await handleRichMenuChat({env:{smart_menu_db:scopedDb,smart_menu_assets:privateAssetBucket(db,config.workspace_id)},account,event,signatureVerified:true,reply});if(r.background)ctx.waitUntil(r.background);
 }
 return json({success:true});
}

export async function menuUploadPublic(req,env,ctx,path){
 if(!/^\/(bootstrap|session|image|jobs\/[a-f0-9-]{36})$/.test(path))return json({success:false,error:'NOT_FOUND'},404);
 if(!env.PLATFORM_DB||env.DEMO_MODE==='on')return json({success:false,error:'MENU_UPLOAD_CONFIG_UNAVAILABLE'},409);
 const accountId=new URL(req.url).searchParams.get('lineAccountId');if(!/^[A-Za-z0-9_-]{1,120}$/.test(accountId||''))return json({success:false,error:'MENU_UPLOAD_INPUT_INVALID'},400);
 const record=await env.PLATFORM_DB.prepare('SELECT workspace_id FROM workspace_line_accounts WHERE id=? AND webhook_enabled=1').bind(accountId).first();if(!record)return json({success:false,error:'MENU_UPLOAD_CONFIG_UNAVAILABLE'},409);
 const authority=()=>env.DB.prepare("SELECT w.operator_id FROM platform_workspaces w JOIN platform_workspace_entitlements e ON e.workspace_id=w.id AND e.module='CORE_MENU' AND e.enabled=1 WHERE w.source_workspace_id=? AND w.status='active' AND EXISTS(SELECT 1 FROM staff_users u WHERE u.operator_id=w.operator_id AND u.role='operator_owner' AND u.active=1) AND (w.scope_kind='operator' OR EXISTS(SELECT 1 FROM businesses b JOIN platform_business_members m ON m.business_id=b.id AND m.operator_id=b.operator_id JOIN staff_users u ON u.id=m.user_id AND u.active=1 AND u.role='business_admin' WHERE b.id=w.business_id AND b.operator_id=w.operator_id AND b.is_tenant=1 AND m.active=1))").bind(record.workspace_id).first();
 const scope=await authority();if(!scope)return json({success:false,error:'MENU_UPLOAD_FORBIDDEN'},403);
 const db={...credentialDatabase(env.PLATFORM_DB,env,scope.operator_id,record.workspace_id),menuAuthority:async()=>Boolean(await authority())};
 const url=new URL(req.url);url.pathname=path;
 return createRichMenuUploadRoutes().fetch(new Request(url,req),{smart_menu_db:db,smart_menu_assets:privateAssetBucket(env.PLATFORM_DB,record.workspace_id)},ctx);
}

export async function menuChatMaintenance(env){
 if(!env.PLATFORM_DB||!env.DB||env.DEMO_MODE==='on'||env.PLATFORM_RUNTIME_ENABLED!=='on')return;
 const db=env.PLATFORM_DB;
 await db.batch([db.prepare("UPDATE rich_menu_chat_jobs SET phase='uncertain',error_code='JOB_INTERRUPTED' WHERE phase IN ('checking','publishing') AND updated_at<datetime('now','-3 minutes')"),db.prepare("UPDATE rich_menu_chat_sessions SET phase='uncertain' WHERE phase='busy' AND updated_at<datetime('now','-3 minutes')")]);
 const accounts=(await db.prepare('SELECT DISTINCT a.id,a.workspace_id FROM workspace_line_accounts a JOIN startup_park_menu_chat_connections c ON c.workspace_id=a.workspace_id AND c.line_account_id=a.id JOIN rich_menu_chat_refresh_sources s ON s.workspace_id=a.workspace_id AND s.line_account_id=a.id LEFT JOIN rich_menu_chat_refresh_state r ON r.workspace_id=a.workspace_id AND r.line_account_id=a.id WHERE a.webhook_enabled=1 ORDER BY COALESCE(r.next_attempt_at,0) LIMIT 4').all()).results||[];
 for(const row of accounts){
  const scope=await env.DB.prepare("SELECT w.operator_id FROM platform_workspaces w JOIN platform_workspace_entitlements e ON e.workspace_id=w.id AND e.module='CORE_MENU' AND e.enabled=1 WHERE w.source_workspace_id=? AND w.status='active' AND EXISTS(SELECT 1 FROM staff_users u WHERE u.operator_id=w.operator_id AND u.role='operator_owner' AND u.active=1) AND (w.scope_kind='operator' OR EXISTS(SELECT 1 FROM businesses b JOIN platform_business_members m ON m.business_id=b.id AND m.operator_id=b.operator_id JOIN staff_users u ON u.id=m.user_id AND u.active=1 AND u.role='business_admin' WHERE b.id=w.business_id AND b.operator_id=w.operator_id AND b.is_tenant=1 AND m.active=1))").bind(row.workspace_id).first();if(!scope)continue;
  try{const account=await credentialDatabase(db,env,scope.operator_id,row.workspace_id).prepare('SELECT * FROM workspace_line_accounts WHERE workspace_id=? AND id=? AND webhook_enabled=1').bind(row.workspace_id,row.id).first();if(account?.line_bot_channel_access_token)await processMenuRefresh({smart_menu_db:db},account);}catch{console.error('MENU_CHAT_REFRESH_DEFERRED');}
 }
}
