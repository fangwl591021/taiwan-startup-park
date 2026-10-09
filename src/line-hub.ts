import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail,audit} from './shared.js';
import {body,text,version,json,role,requireModule} from './workspace-common.js';
import {credentialStorageReady,encryptLineSecret,decryptStoredSecret} from './line-credentials.js';
type Row=Record<string,any>;
export async function hubRoute(req:Request,env:Env,a:Actor):Promise<Response|null>{
 const path=new URL(req.url).pathname;if(!path.startsWith('/api/line/hub'))return null;
 role(a,['operator_owner']);await requireModule(env,a,'line_hub');
 if(path==='/api/line/hub'&&req.method==='GET'){
  const rules=(await stmt(env,'SELECT * FROM line_keyword_routes WHERE operator_id=? ORDER BY keyword LIMIT 100',a.operator_id).all<Row>()).results;
  const accounts=(await stmt(env,'SELECT c.id,c.name,c.channel_id,c.provider_id,c.last_webhook_at,l.channel_id AS login_channel_id,l.provider_id AS login_provider_id,l.encrypted_secret,l.version AS login_version FROM line_connections c LEFT JOIN operator_line_login l ON l.connection_id=c.id AND l.operator_id=c.operator_id WHERE c.operator_id=? ORDER BY c.name LIMIT 50',a.operator_id).all<Row>()).results;
  const contacts=(await stmt(env,`SELECT c.id,l.person_id,c.connection_id,p.name,p.business_id,c.conversation_id,(SELECT body FROM line_events e WHERE e.connection_id=c.connection_id AND e.user_id=c.user_id AND e.kind='message' ORDER BY e.event_at DESC,e.event_id DESC LIMIT 1) AS preview FROM line_contacts c JOIN crm_line_links l ON l.operator_id=c.operator_id AND l.line_contact_id=c.id JOIN crm_people p ON p.id=l.person_id AND p.operator_id=l.operator_id WHERE c.operator_id=? ORDER BY c.created_at DESC LIMIT 50`,a.operator_id).all<Row>()).results;
  const projection=await Promise.all(accounts.map(async c=>{const{encrypted_secret,...rest}=c;return {...rest,login_channel_id:c.login_channel_id||'',login_provider_id:c.login_provider_id||'',login_version:c.login_version||1,has_login_secret:!!(await decryptStoredSecret(env,'__operator_login__:'+a.operator_id,c.id+':'+(c.login_channel_id||''),encrypted_secret||'')).channelSecret};}));
  return json({rules,accounts:projection,contacts:contacts.map(c=>({...c,destinations:[...new Set(rules.filter(r=>r.enabled&&c.preview&&(r.match_type==='exact'?String(c.preview).trim()===r.keyword:String(c.preview).includes(r.keyword))).map(r=>r.destination))]})),login_enabled:false,push_enabled:false,storage_ready:env.APP_ENV!=='sandbox'&&credentialStorageReady(env)});
 }
 const route=path.match(/^\/api\/line\/hub\/routes(?:\/([^/]+))?$/);
 if(route&&['POST','PATCH'].includes(req.method)){
  const d=await body(req,['keyword','match_type','destination','enabled','version']),keyword=text(d.keyword,'關鍵字',80),match=text(d.match_type,'比對方式',20),dest=text(d.destination,'分類',20);
  if(!['exact','contains'].includes(match)||!['address','renewal','mail','billing','support'].includes(dest)||typeof d.enabled!=='boolean')fail(400,'關鍵字設定格式不正確');
  const id=route[1]||uid(),at=now();
  try{
   const r=await env.DB.batch([
    route[1]?stmt(env,'UPDATE line_keyword_routes SET keyword=?,match_type=?,destination=?,enabled=?,version=version+1,updated_at=? WHERE operator_id=? AND id=? AND version=?',keyword,match,dest,d.enabled?1:0,at,a.operator_id,id,version(d.version)):stmt(env,'INSERT INTO line_keyword_routes(id,operator_id,keyword,match_type,destination,enabled,updated_at) VALUES(?,?,?,?,?,?,?)',id,a.operator_id,keyword,match,dest,d.enabled?1:0,at),
    audit(env,a,null,null,'line_keyword_route_saved',{route_id:id,destination:dest},true)
   ]);if(!r[0].meta.changes)fail(409,'分類設定已更新，請重新整理');
  }catch(e){if(String(e).includes('UNIQUE'))fail(409,'此關鍵字已設定，請修改既有分類');throw e;}
  return json({id,automatic_reply:false},route[1]?200:201);
 }
 const login=path.match(/^\/api\/line\/hub\/accounts\/([^/]+)\/login$/);
 if(login&&req.method==='PATCH'){
  if(env.APP_ENV==='sandbox')fail(403,'測試環境不保存真實憑證');
  const c=await stmt(env,'SELECT id,provider_id FROM line_connections WHERE operator_id=? AND id=?',a.operator_id,login[1]).first<Row>();if(!c)fail(404,'找不到業者 OA');
  const d=await body(req,['channel_id','provider_id','channel_secret','version','reference']),channel=text(d.channel_id,'Login Channel ID',20,true),provider=text(d.provider_id,'Login Provider ID',20,true),v=version(d.version),reference=text(d.reference,'設定依據',500);
  if(channel&&!/^\d{1,20}$/.test(channel)||provider&&!/^\d{1,20}$/.test(provider))fail(400,'Channel／Provider ID 應為數字');
  const old=await stmt(env,'SELECT * FROM operator_line_login WHERE operator_id=? AND connection_id=?',a.operator_id,c.id).first<Row>();
  if((old?.version||1)!==v)fail(409,'設定已更新');
  let encrypted=old?.channel_id===channel?old.encrypted_secret:'';
  if(d.channel_secret){const secret=text(d.channel_secret,'Login Channel secret',32);if(!channel||!/^[a-f0-9]{32}$/i.test(secret))fail(400,'請填 Login Channel ID 及正確 32 位密鑰');encrypted=await encryptLineSecret(env,'__operator_login__:'+a.operator_id,c.id+':'+channel,{channelSecret:secret});}
  const r=await env.DB.batch([
   old?stmt(env,'UPDATE operator_line_login SET channel_id=?,provider_id=?,encrypted_secret=?,version=version+1,updated_at=? WHERE operator_id=? AND connection_id=? AND version=?',channel,provider,encrypted,now(),a.operator_id,c.id,v):stmt(env,'INSERT OR IGNORE INTO operator_line_login(connection_id,operator_id,channel_id,provider_id,encrypted_secret,version,updated_at) VALUES(?,?,?,?,?,2,?)',c.id,a.operator_id,channel,provider,encrypted,now()),
   audit(env,a,null,null,'operator_login_settings_saved',{connection_id:c.id,reference,login_enabled:false},true)
  ]);if(!r[0].meta.changes)fail(409,'設定已更新');return json({ok:true,login_enabled:false,provider_linkage_confirmed:false});
 }
 return fail(404,'找不到此 LINE OA 工作台操作');
}
