import { getRichMenuAlias, publishRichMenuToLine } from './line-rich-menu.mjs';
import { richMenuAliasIdForProject, projectAreaActionFromRow, normalizeProjectAreaAction } from '../../upstream-smart-menu/backend/src/project-actions.mjs';
import { requireWorkspaceModule } from '../../../.migration-build/smart-menu/backend/src/modules/entitlements.ts';
import { readMenuImage } from './rich-menu-chat-image.mjs';
import { menuUploadGeometry } from './rich-menu-upload-layout.mjs';

export const CHANGE_MENU_KEYWORD = '修改選單';
const PREFIX = 'menu-change:';
const clean = v => String(v || '').normalize('NFKC').trim();
const message = text => ({ type:'text', text });
const busy = '圖片正在檢查／部署中，請在後台「聊天室修改選單」查看結果，請勿重複上傳。';
const uncertain = '選單發布結果未能確認。請至後台「聊天室修改選單」查看發布紀錄並核對 LINE 選單；系統不會自動重複發布。';
const result = status => ({ handled:true, status });
const scopeOf = account => [account.workspace_id,account.id];
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
export function keywordOverlapsChangeMenu(keyword, type='exact') {
  const value=clean(keyword);return Boolean(value)&&(type==='prefix'?CHANGE_MENU_KEYWORD.startsWith(value):type==='contains'?CHANGE_MENU_KEYWORD.includes(value):value===CHANGE_MENU_KEYWORD);
}
export function mightBeRichMenuChatTurn(event) {
  return event?.source?.type==='user' && (event.type==='postback'&&String(event.postback?.data||'').startsWith(PREFIX)
    || event.type==='message'&&(['image','file'].includes(event.message?.type)||event.message?.type==='text'&&(clean(event.message.text)===CHANGE_MENU_KEYWORD||clean(event.message.text)==='取消'||/^\d{1,4}$/.test(clean(event.message.text)))));
}
export async function canChangeRichMenu(db,account,uid) {
  if(!/^U[a-f0-9]{32}$/.test(uid))return false;
  if(db.menuAuthority&&!await db.menuAuthority())return false;
  const row=await db.prepare(`SELECT o.enabled FROM rich_menu_chat_operators o JOIN workspace_line_accounts a ON a.id=o.line_account_id AND a.workspace_id=o.workspace_id
    JOIN workspaces w ON w.id=o.workspace_id WHERE o.workspace_id=? AND o.line_account_id=? AND o.line_user_id=? AND o.enabled=1
    AND a.webhook_enabled=1 AND w.deleted_at IS NULL AND w.status='active'`).bind(...scopeOf(account),uid).first();
  if(!row)return false;
  try{await requireWorkspaceModule({db,workspaceId:account.workspace_id,moduleKey:'CORE_MENU'});return true;}catch{return false;}
}
export async function acquireMenuLease(db,account,token,now=Date.now()) {
  const changed=await db.prepare(`INSERT INTO rich_menu_chat_leases(workspace_id,line_account_id,token,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(workspace_id,line_account_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE rich_menu_chat_leases.expires_at<?`)
    .bind(...scopeOf(account),token,now+120000,now).run();return Number(changed.meta?.changes)===1;
}
export async function releaseMenuLease(db,account,token) {
  await db.prepare('DELETE FROM rich_menu_chat_leases WHERE workspace_id=? AND line_account_id=? AND token=?').bind(...scopeOf(account),token).run();
}
async function lineRead(account,path,fetcher) {
  const response=await fetcher('https://api.line.me/v2/bot/'+path,{headers:{Authorization:'Bearer '+account.line_bot_channel_access_token},signal:AbortSignal.timeout(8000)});
  if(response.status===404&&path==='user/all/richmenu')return {richMenuId:null};
  if(!response.ok)throw new Error('LINE_READ_FAILED');return response.json();
}
export async function loadMenuSnapshot(db,account,projectId,fetcher=fetch) {
  const project=await db.prepare(`SELECT p.*,a.width image_width,a.height image_height FROM projects p
    JOIN assets a ON a.id=p.asset_id AND a.workspace_id=p.workspace_id AND a.deleted_at IS NULL
    WHERE p.id=? AND p.workspace_id=? AND p.deleted_at IS NULL AND p.status IN ('published','default')`).bind(projectId,account.workspace_id).first();
  if(!project)throw new Error('PROJECT_UNAVAILABLE');
  const areas=(await db.prepare('SELECT * FROM project_areas WHERE project_id=? AND workspace_id=? ORDER BY area_index,id').bind(projectId,account.workspace_id).all()).results||[];
  const aliasId=richMenuAliasIdForProject(project.id),alias=await getRichMenuAlias(fetcher,account.line_bot_channel_access_token,aliasId);
  if(!/^richmenu-[a-f0-9]{32}$/.test(alias?.richMenuId||''))throw new Error('MENU_NOT_PUBLISHED');
  const [menu,home]=await Promise.all([lineRead(account,'richmenu/'+alias.richMenuId,fetcher),lineRead(account,'user/all/richmenu',fetcher)]);
  const config={size:menu.size,selected:menu.selected,name:menu.name,chatBarText:menu.chatBarText,areas:menu.areas};
  if(!Array.isArray(config.areas)||config.areas.length!==areas.length||!areas.length)throw new Error('LAYOUT_CHANGED');
  // A draft edited after publication cannot be silently paired with the old LINE artwork.
  const expected=areas.map(a=>({x:a.x,y:a.y,width:a.width,height:a.height}));
  const published=config.areas.map(a=>({x:a.bounds?.x,y:a.bounds?.y,width:a.bounds?.width,height:a.bounds?.height}));
  if(JSON.stringify(expected)!==JSON.stringify(published))throw new Error('LAYOUT_CHANGED');
  for(let i=0;i<areas.length;i++){
    const stored=projectAreaActionFromRow(areas[i]),live=config.areas[i].action;
    const matches=stored.type==='richmenuswitch'?live?.type===stored.type&&live.richMenuAliasId===stored.richMenuAliasId&&live.data===stored.data:
      JSON.stringify(stored)===JSON.stringify(normalizeProjectAreaAction(live));
    if(!matches)throw new Error('LAYOUT_CHANGED');
    if(stored.type==='richmenuswitch'&&!await db.prepare("SELECT id FROM projects WHERE workspace_id=? AND id=? AND deleted_at IS NULL AND status<>'disabled'").bind(account.workspace_id,stored.targetPageId).first())throw new Error('LAYOUT_CHANGED');
  }
  const snapshot={project,areas,aliasId,oldMenuId:alias.richMenuId,homeMenuId:home.richMenuId||null,config};
  return {...snapshot,fingerprint:await digest(snapshot)};
}
function choiceMessage(candidates,run,page=0) {
  const first=Math.max(0,Math.min(Math.floor((candidates.length-1)/10),page))*10;
  const items=candidates.slice(first,first+10).map((p,i)=>({type:'action',action:{type:'postback',label:`${first+i+1}. ${p.name}`.slice(0,20),displayText:`修改選單：${p.name}`.slice(0,300),data:`${PREFIX}select?run=${run}&slot=${first+i}`}}));
  for(const [label,target] of [['上一頁',first/10-1],['下一頁',first/10+1]])if(target>=0&&target*10<candidates.length)items.push({type:'action',action:{type:'postback',label,data:`${PREFIX}page?run=${run}&page=${target}`}});
  items.push({type:'action',action:{type:'postback',label:'取消',data:`${PREFIX}cancel?run=${run}`}});
  return {type:'text',text:'請選擇要修改的已發布選單（只換圖片，保留按鈕與功能）：\n'+candidates.slice(first,first+10).map((p,i)=>`${first+i+1}：${p.name}`).join('\n')+'\n也可輸入編號；輸入「取消」結束。',quickReply:{items}};
}
export async function menuUploadLiffConfig(db,id,workspaceId){
 if(db.menuAuthority&&!await db.menuAuthority())throw Error('MENU_UPLOAD_CONFIG_UNAVAILABLE');
 const row=await db.prepare('SELECT a.*,c.liff_id FROM workspace_line_accounts a JOIN startup_park_menu_chat_connections c ON c.workspace_id=a.workspace_id AND c.line_account_id=a.id WHERE a.id=? AND a.webhook_enabled=1').bind(id).first();
 if(!row||workspaceId&&row.workspace_id!==workspaceId||!/^\d+-[A-Za-z0-9]+$/.test(row.liff_id||'')||row.liff_id.split('-')[0]!==row.line_login_channel_id)throw Error('MENU_UPLOAD_CONFIG_UNAVAILABLE');
 return {account:row,liffId:row.liff_id,lineLoginChannelId:row.line_login_channel_id,endpointPath:'/api/line/webhook/menu-upload/page',portalSlug:null,status:'NOT_RUNTIME_VERIFIED'};
}
export async function menuUploadLiffUrl(db,account,run){const config=await menuUploadLiffConfig(db,account.id,account.workspace_id),url=new URL('https://liff.line.me/'+config.liffId);url.search=new URLSearchParams({menuUpload:'1',menuRun:run,lineAccountId:account.id}).toString();return url.href;}
async function uploadMessage(db,account,snapshot,run) {
  let upload={type:'cameraRoll',label:'上傳圖片'};
  try{upload={type:'uri',label:'上傳圖片',uri:await menuUploadLiffUrl(db,account,run)};}catch{};

  return {type:'text',text:`已選擇「${snapshot.project.name}」。請按「上傳圖片」選擇 JPG／PNG 原圖，檔案小於 1 MB，需與原版型 ${snapshot.config.size.width} × ${snapshot.config.size.height} 同比例。\n大版可用 2500 × 1686；小版可用 2500 × 843。只換圖片、不使用 AI、不改按鈕功能。上傳頁可微調按鈕範圍並查看完成結果；也可在聊天室以「檔案」傳送原圖。`,quickReply:{items:[{type:'action',action:upload},{type:'action',action:{type:'postback',label:'取消',data:`${PREFIX}cancel?run=${run}`}}]}};
}
export async function handleRichMenuChat({env,account,event,signatureVerified,reply,fetcher=fetch,notify}) {
  if(!signatureVerified||!mightBeRichMenuChatTurn(event))return {handled:false};
  const db=env.smart_menu_db,uid=event.source.userId,input=clean(event.type==='postback'?event.postback?.data:event.message?.type==='text'?event.message.text:''),start=input===CHANGE_MENU_KEYWORD;
  const session=await db.prepare('SELECT * FROM rich_menu_chat_sessions WHERE workspace_id=? AND line_account_id=? AND line_user_id=?').bind(...scopeOf(account),uid).first();
  const active=session&&session.expires_at>Date.now(),internal=input.startsWith(PREFIX);
  if(!start&&!internal&&!active)return {handled:false};
  const send=async value=>{await reply(account.line_bot_channel_access_token,{replyToken:event.replyToken,messages:[typeof value==='string'?message(value):value]});};
  if(!event.replyToken)return result('NO_REPLY_TOKEN');
  const eventId=String(event.webhookEventId||event.message?.id||'');if(!eventId)return result('EVENT_ID_REQUIRED');
  const claimed=await db.prepare('INSERT OR IGNORE INTO rich_menu_chat_events(workspace_id,line_account_id,event_id) VALUES(?,?,?)').bind(...scopeOf(account),eventId).run();
  if(!claimed.meta?.changes)return result('DUPLICATE');
  if(!await canChangeRichMenu(db,account,uid)){await send(`此功能僅限已授權的聊天室選單管理員。請由工作區管理員到「聊天室修改選單」加入授權名單。不需要新增後台帳號。你的 UID：${uid}`);return result('FORBIDDEN');}
  if(active&&session.phase==='busy'){await send(busy);return result('BUSY');}
  if(start){
    if(session?.phase==='uncertain'){await send(uncertain);return result('UNCERTAIN');}
    const candidates=(await db.prepare(`SELECT id,name FROM projects WHERE workspace_id=? AND deleted_at IS NULL AND status IN ('published','default') ORDER BY status ASC,name ASC,id LIMIT 1000`).bind(account.workspace_id).all()).results||[];
    if(!candidates.length){await send('目前沒有可修改的已發布選單，請先在後台發布圖文選單。');return result('NO_MENUS');}
    const run=crypto.randomUUID();await db.prepare(`INSERT INTO rich_menu_chat_sessions(workspace_id,line_account_id,line_user_id,run_id,phase,candidates_json,expires_at)
      VALUES(?,?,?,?,'choose',?,?) ON CONFLICT(workspace_id,line_account_id,line_user_id) DO UPDATE SET run_id=excluded.run_id,phase='choose',candidates_json=excluded.candidates_json,snapshot_json=NULL,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(...scopeOf(account),uid,run,JSON.stringify(candidates),Date.now()+1800000).run();await send(choiceMessage(candidates,run));return result('CHOOSE');
  }
  if(!active){await send('選單流程已逾時，請重新輸入「修改選單」。');return result('EXPIRED');}
  const [action,query='']=input.split('?'),params=new URLSearchParams(query);
  if(internal&&params.get('run')!==session.run_id){await send('這個按鈕已失效，請使用最新選單流程。');return result('STALE_BUTTON');}
  if(input==='取消'||action===PREFIX+'cancel'){
    // An ambiguous external publication must be reconciled, not cancelled into a retry.
    if(session.phase==='uncertain'){await send(uncertain);return result('UNCERTAIN');}
    await db.prepare("UPDATE rich_menu_chat_sessions SET phase='cancelled',expires_at=0 WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase<>'busy'").bind(...scopeOf(account),uid,session.run_id).run();await send('已取消修改選單，原圖與按鈕未變更。');return result('CANCELLED');
  }
  if(session.phase==='choose'){
    const candidates=JSON.parse(session.candidates_json);
    if(action===PREFIX+'page'){await send(choiceMessage(candidates,session.run_id,Number(params.get('page'))||0));return result('CHOOSE');}
    const slot=action===PREFIX+'select'&&/^\d{1,4}$/.test(params.get('slot')||'')?Number(params.get('slot')):/^\d+$/.test(input)?Number(input)-1:-1;
    if(!Number.isSafeInteger(slot)||!candidates[slot]){await send(choiceMessage(candidates,session.run_id));return result('CHOOSE');}
    let snapshot;try{snapshot=await loadMenuSnapshot(db,account,candidates[slot].id,fetcher);}catch{await send('無法核對此選單的已發布圖片與按鈕。請先在後台確認並重新發布，或選擇其他選單。');return result('MENU_UNAVAILABLE');}
    const selected=await db.prepare(`UPDATE rich_menu_chat_sessions SET phase='upload',snapshot_json=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase='choose'`)
      .bind(JSON.stringify(snapshot),...scopeOf(account),uid,session.run_id).run();
    if(!selected.meta?.changes){await send('選單流程已變更，請使用最新流程。');return result('STALE');}
    await send(await uploadMessage(db,account,snapshot,session.run_id));return result('UPLOAD');
  }
  if(session.phase!=='upload'){await send(session.phase==='uncertain'?uncertain:'上一個流程已結束；請重新輸入「修改選單」。');return result(session.phase.toUpperCase());}
  const snapshot=JSON.parse(session.snapshot_json);
  if(!['image','file'].includes(event.message?.type)){await send(await uploadMessage(db,account,snapshot,session.run_id));return result('UPLOAD');}
  const won=await db.prepare(`UPDATE rich_menu_chat_sessions SET phase='busy',updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase='upload' AND snapshot_json=? AND expires_at>?`)
    .bind(...scopeOf(account),uid,session.run_id,session.snapshot_json,Date.now()).run();
  if(!won.meta?.changes){await send(busy);return result('BUSY');}
  const jobId=crypto.randomUUID();
  await db.prepare(`INSERT INTO rich_menu_chat_jobs(id,workspace_id,line_account_id,project_id,line_user_id,event_id,phase,snapshot_json,old_asset_id,old_menu_id,notification_status) VALUES(?,?,?,?,?,?,'checking',?,?,?,'suppressed')`)
    .bind(jobId,...scopeOf(account),snapshot.project.id,uid,eventId,session.snapshot_json,snapshot.project.asset_id,snapshot.oldMenuId).run();
  try{await send(busy);}catch{
    await db.prepare("UPDATE rich_menu_chat_jobs SET phase='failed',error_code='ACK_FAILED' WHERE id=?").bind(jobId).run();
    await db.prepare("UPDATE rich_menu_chat_sessions SET phase='upload' WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase='busy'").bind(...scopeOf(account),uid,session.run_id).run();return result('ACK_FAILED');
  }
  // Same job is kept alive by waitUntil. No second reply token or duplicate publisher.
  return {...result('PROCESSING'),background:runMenuJob({env,account,uid,event,session,snapshot,jobId,fetcher,notify})};
}
export async function runMenuJob({env,account,uid,event,session,snapshot,jobId,fetcher=fetch,notify,directImage,uploadLayout=/** @type {import('./rich-menu-upload-layout.mjs').MenuUploadLayout|null} */(null)}) {
  const db=env.smart_menu_db,signal=AbortSignal.timeout(27000),timedFetch=(url,init={})=>fetcher(url,{...init,signal:AbortSignal.any([signal,...(init.signal?[init.signal]:[])])});
  let locked=false,publishing=false,phase='failed',code='VALIDATION_FAILED';
  try{
    const image=directImage||await readMenuImage(account.line_bot_channel_access_token,event.message.id,timedFetch);
    if(!image)throw new Error('IMAGE_INVALID');
    const {mapped,lineAreas}=menuUploadGeometry(snapshot,image,uploadLayout);
    if(!await canChangeRichMenu(db,account,uid))throw new Error('PERMISSION_CHANGED');
    locked=await acquireMenuLease(db,account,jobId);if(!locked)throw new Error('ACCOUNT_BUSY');
    const current=await loadMenuSnapshot(db,account,snapshot.project.id,timedFetch);
    if(current.fingerprint!==snapshot.fingerprint)throw new Error('MENU_CHANGED');
    const assetId='asset_'+crypto.randomUUID(),key=`workspaces/${account.workspace_id}/rich-menu-chat/${jobId}.${image.contentType==='image/png'?'png':'jpg'}`;
    await env.smart_menu_assets.put(key,image.bytes,{httpMetadata:{contentType:image.contentType}});
    // The new image and journal remain recoverable even if LINE's result is uncertain.
    await db.batch([db.prepare(`INSERT INTO assets(id,workspace_id,storage_key,original_filename,content_type,size_bytes,width,height,status) VALUES(?,?,?,?,?,?,?,?,'ready')`)
      .bind(assetId,account.workspace_id,key,'chat-menu-'+jobId,image.contentType,image.bytes.length,image.width,image.height),
      db.prepare('UPDATE rich_menu_chat_jobs SET new_asset_id=? WHERE id=?').bind(assetId,jobId)]);
    if(!await canChangeRichMenu(db,account,uid))throw new Error('PERMISSION_CHANGED');
    if((await loadMenuSnapshot(db,account,snapshot.project.id,timedFetch)).fingerprint!==snapshot.fingerprint)throw new Error('MENU_CHANGED');
    await db.prepare("UPDATE rich_menu_chat_jobs SET phase='publishing',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();publishing=true;
    const published=await publishRichMenuToLine({fetcher:timedFetch,channelAccessToken:account.line_bot_channel_access_token,
      richMenuObject:{...snapshot.config,size:{width:image.width,height:image.height},areas:lineAreas.map(a=>({bounds:{x:a.x,y:a.y,width:a.width,height:a.height},action:a.action}))},
      imageBody:image.bytes,imageContentType:image.contentType,richMenuAliasId:snapshot.aliasId,setDefault:snapshot.homeMenuId===snapshot.oldMenuId,
      onProgress:async progress=>{await db.prepare("UPDATE rich_menu_chat_jobs SET new_menu_id=?,progress_json=json_patch(COALESCE(progress_json,'{}'),?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(progress.richMenuId,JSON.stringify(progress),jobId).run();}});
    // Transaction-local gate protects every coordinate and image write from stale editors.
    const statements=[db.prepare(`INSERT INTO rich_menu_sync_guards(id) SELECT ? FROM projects WHERE id=? AND workspace_id=? AND sync_revision=? AND asset_id=? AND deleted_at IS NULL AND status=?`)
      .bind(jobId,snapshot.project.id,account.workspace_id,snapshot.project.sync_revision,snapshot.project.asset_id,snapshot.project.status),
      db.prepare('UPDATE projects SET asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM rich_menu_sync_guards WHERE id=?)').bind(assetId,snapshot.project.id,account.workspace_id,jobId)];
    for(const a of mapped)statements.push(db.prepare('UPDATE project_areas SET x=?,y=?,width=?,height=? WHERE id=? AND project_id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM rich_menu_sync_guards WHERE id=?)').bind(a.x,a.y,a.width,a.height,a.id,snapshot.project.id,account.workspace_id,jobId));
    statements.push(db.prepare(`INSERT OR IGNORE INTO rich_menu_chat_refresh_sources(workspace_id,line_account_id,from_menu_id,project_id) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM rich_menu_sync_guards WHERE id=?)`).bind(...scopeOf(account),snapshot.oldMenuId,snapshot.project.id,jobId),
      db.prepare("UPDATE rich_menu_chat_jobs SET phase='succeeded',new_menu_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM rich_menu_sync_guards WHERE id=?)").bind(published.richMenuId,jobId,jobId),
      db.prepare('DELETE FROM rich_menu_sync_guards WHERE id=?').bind(jobId));
    const committed=await db.batch(statements);if(!committed[0].meta?.changes)throw new Error('MENU_CHANGED_AFTER_PUBLISH');
    phase='done';code=null;
  }catch(error){
    code=['IMAGE_INVALID','IMAGE_UNAVAILABLE','IMAGE_RATIO_MISMATCH','AREA_INVALID','PERMISSION_CHANGED','ACCOUNT_BUSY','MENU_CHANGED','MENU_CHANGED_AFTER_PUBLISH'].includes(error?.message)?error.message:'MENU_UPDATE_FAILED';
    if(publishing){phase='uncertain';}
    else if(['IMAGE_INVALID','IMAGE_UNAVAILABLE','IMAGE_RATIO_MISMATCH','AREA_INVALID'].includes(code)){
      phase='upload';
    }else if(code==='ACCOUNT_BUSY'){phase='upload';}
    await db.prepare('UPDATE rich_menu_chat_jobs SET phase=?,error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(publishing?'uncertain':'failed',code,jobId).run();
  }finally{
    await db.prepare('UPDATE rich_menu_chat_sessions SET phase=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase=\'busy\'').bind(phase,...scopeOf(account),uid,session.run_id).run();
    if(locked)await releaseMenuLease(db,account,jobId).catch(()=>console.error('MENU_CHAT_LEASE_RELEASE_FAILED'));
  }
  // Results are read from the scoped job endpoint/admin journal. Never send a
  // completion push or reuse the processing reply token for a second reply.
  await db.prepare("UPDATE rich_menu_chat_jobs SET notification_status='suppressed' WHERE id=?").bind(jobId).run();
  if(phase==='done')await processMenuRefresh(env,account,fetcher).catch(()=>console.error('MENU_CHAT_REFRESH_DEFERRED'));
}

const validMenu=id=>/^richmenu-[a-f0-9]{32}$/.test(String(id||''));
export function planMenuRefresh(sources,targets) {
  return sources.flatMap(s=>{const to=targets.get(s.project_id);return validMenu(s.from_menu_id)&&validMenu(to)&&s.from_menu_id!==to&&s.completed_target!==to?[{type:'link',from:s.from_menu_id,to}]:[];}).slice(0,1000);
}
export async function processMenuRefresh(env,account,fetcher=fetch,now=Date.now()) {
  const db=env.smart_menu_db,lease=crypto.randomUUID();if(!await acquireMenuLease(db,account,lease,now))return {phase:'busy'};
  const write=state=>db.prepare(`INSERT INTO rich_menu_chat_refresh_state(workspace_id,line_account_id,state_json,next_attempt_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id,line_account_id) DO UPDATE SET state_json=excluded.state_json,next_attempt_at=excluded.next_attempt_at`).bind(...scopeOf(account),JSON.stringify(state),state.nextAttemptAt||0).run();
  let state;
  try{
    const stored=await db.prepare('SELECT * FROM rich_menu_chat_refresh_state WHERE workspace_id=? AND line_account_id=?').bind(...scopeOf(account)).first();state=stored?JSON.parse(stored.state_json):null;
    const sources=(await db.prepare('SELECT * FROM rich_menu_chat_refresh_sources WHERE workspace_id=? AND line_account_id=?').bind(...scopeOf(account)).all()).results||[];
    const call=async(path,body)=>{const r=await fetcher('https://api.line.me/v2/bot/richmenu/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+account.line_bot_channel_access_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});return {ok:r.ok,status:r.status,requestId:r.headers.get('x-line-request-id'),json:r.ok&&(!body||path==='validate/batch')?await r.json().catch(()=>({})):null};};
    if(state&&state.phase!=='succeeded'){
      if(now-state.createdAt>13*86400000){state.phase='expired';await write(state);return state;}
      if(state.requestId){
        const progress=await call('progress/batch?requestId='+encodeURIComponent(state.requestId));if(!progress.ok)return {phase:'progress-unavailable'};
        state.phase=progress.json.phase;
        if(state.phase==='succeeded'){
          const statements=state.operations.map(op=>db.prepare('UPDATE rich_menu_chat_refresh_sources SET completed_target=? WHERE workspace_id=? AND line_account_id=? AND from_menu_id=?').bind(op.to,...scopeOf(account),op.from));
          statements.push(db.prepare('INSERT OR IGNORE INTO rich_menu_chat_refresh_receipts(resume_key,workspace_id,line_account_id,state_json) VALUES(?,?,?,?)').bind(state.resumeRequestKey,...scopeOf(account),JSON.stringify(state)));await db.batch(statements);
        }
        await write(state);if(state.phase!=='failed')return state;
      }
      if(now<state.nextAttemptAt)return state;
    }else{
      if(state&&now<state.nextAttemptAt)return {phase:'rate-wait'};
      const targets=new Map();
      for(const projectId of [...new Set(sources.map(s=>s.project_id))]){
        const project=await db.prepare("SELECT id FROM projects WHERE id=? AND workspace_id=? AND status IN ('published','default') AND deleted_at IS NULL").bind(projectId,account.workspace_id).first();if(!project)continue;
        const alias=await getRichMenuAlias(fetcher,account.line_bot_channel_access_token,richMenuAliasIdForProject(projectId));targets.set(projectId,alias?.richMenuId);
      }
      const operations=planMenuRefresh(sources,targets);if(!operations.length){await write({phase:'succeeded',nextAttemptAt:now+20*60*1000+1000,operations:[]});return {phase:'idle'};}
      if(!(await call('validate/batch',{operations})).ok)return {phase:'validation-failed'};
      state={phase:'queued',operations,resumeRequestKey:crypto.randomUUID(),createdAt:now,nextAttemptAt:now};
    }
    state.phase='submitting';state.nextAttemptAt=now+20*60*1000+1000;await write(state);
    const submitted=await call('batch',{operations:state.operations,resumeRequestKey:state.resumeRequestKey});
    state.requestId=submitted.ok?submitted.requestId:null;state.phase=state.requestId?'ongoing':'retry-wait';await write(state);return state;
  }finally{await releaseMenuLease(db,account,lease);}
}
export async function processMenuChatBacklog(env) {
  const db=env.smart_menu_db;
  // A terminated publisher is never retried. Its receipt requires operator review.
  await db.prepare("UPDATE rich_menu_chat_jobs SET phase='uncertain',error_code='JOB_INTERRUPTED' WHERE phase IN ('checking','publishing') AND created_at<datetime('now','-3 minutes')").run();
  await db.prepare("UPDATE rich_menu_chat_sessions SET phase='uncertain' WHERE phase='busy' AND updated_at<datetime('now','-3 minutes')").run();
  const accounts=(await db.prepare(`SELECT a.* FROM workspace_line_accounts a JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.webhook_enabled=1 AND w.status='active' AND w.deleted_at IS NULL AND EXISTS(SELECT 1 FROM rich_menu_chat_refresh_sources s WHERE s.workspace_id=a.workspace_id AND s.line_account_id=a.id)
    ORDER BY COALESCE((SELECT next_attempt_at FROM rich_menu_chat_refresh_state r WHERE r.workspace_id=a.workspace_id AND r.line_account_id=a.id),0) LIMIT 4`).all()).results||[];
  for(const account of accounts)try{await processMenuRefresh(env,account);}catch{console.error('MENU_CHAT_REFRESH_DEFERRED');}
}
