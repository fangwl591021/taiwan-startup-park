import {menuChatRoute,menuChatWebhook,menuUploadPublic,menuChatMaintenance} from './menu-chat/routes.mjs';
import {tenantModuleForPath} from '../../.migration-build/smart-menu/backend/src/modules/entitlements.ts';
import addressWorker from '../../dist/worker.js';
import sourceApp from '../../.migration-build/smart-menu/backend/src/index.ts';
import {actor} from '../../dist/auth.js';
import {runtimeContext} from '../../dist/platform-runtime-context.js';
import {sitesRoute} from './sites.mjs';
import {privateAssetBucket} from './private-assets.mjs';
import {provisionWorkspace} from './provision.mjs';
import {credentialDatabase,encryptAccountBody} from './credentials.mjs';
function response(d,status=200){return Response.json(d,{status});}
function secured(r){const h=new Headers(r.headers);h.delete('Access-Control-Allow-Origin');h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','same-origin');h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return new Response(r.body,{status:r.status,headers:h});}
export default{
 async fetch(req,env,ctx){
  const url=new URL(req.url),match=url.pathname.match(/^\/api\/platform-runtime\/([a-zA-Z0-9_-]+)(\/.*)$/);
  if(url.pathname==='/platform/'||url.pathname.startsWith('/platform/assets/')){
   if(!env.ASSETS)return response({error:'工作區介面尚未建置'},503);
   return secured(await env.ASSETS.fetch(req));
  }
  if(url.pathname.startsWith('/api/line/webhook/menu-upload/')){
   let result;
   if(url.pathname==='/api/line/webhook/menu-upload/page'||/^\/api\/line\/webhook\/menu-upload\/assets-base\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname)){
    if(!['GET','HEAD'].includes(req.method))return response({error:'Method not allowed'},405);
    const file=url.pathname.endsWith('/page')?'/platform/menu-upload':'/platform/assets/'+url.pathname.split('/').at(-1);
    result=env.ASSETS?await env.ASSETS.fetch(new Request(new URL(file,url.origin),req)):response({error:'UI unavailable'},503);
   }else{try{result=await menuUploadPublic(req,env,ctx,url.pathname.slice('/api/line/webhook/menu-upload'.length));}catch{result=response({success:false,error:'MENU_UPLOAD_UNAVAILABLE'},503);}}
   result=secured(result);const headers=new Headers(result.headers);headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://static.line-scdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.line.me https://liff.line.me; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return new Response(result.body,{status:result.status,headers});
  }
  const menuHook=url.pathname.match(/^\/api\/line\/webhook\/runtime\/([a-f0-9-]{36})$/);
  if(menuHook){try{return secured(await menuChatWebhook(req,env,ctx,menuHook[1]));}catch{return secured(response({error:'LINE handling unavailable'},503));}}
  if(!match)return addressWorker.fetch(req,env,ctx);
  let a,c;
  try{
   a=await actor(req,env);c=await runtimeContext(env,a,match[1]);
   const path=match[2];
   if(!path.startsWith('/api/')||/%|\/\/|\.\./.test(path)||['/api/system/','/api/member/'].some(p=>path.startsWith(p))||path==='/api/intelligence/conversions'||path==='/api/commerce/payments/newebpay/notify')return secured(response({success:false,error:'找不到可存取的操作'},404));
   if(!['GET','HEAD'].includes(req.method)&&(req.headers.get('origin')!==url.origin||req.headers.get('x-requested-with')!=='tsp'))return secured(response({success:false,error:'請从已驗證工作台操作'},403));
   const moduleKey=tenantModuleForPath(path)||(/^\/api\/line(?:-|\/)/.test(path)||path.startsWith('/api/site-')||path.startsWith('/api/rich-menu-chat')?'CORE_MENU':path.startsWith('/api/referral-growth')?'CRM':path.startsWith('/api/workspaces/conversion-api-keys')||path.startsWith('/api/intelligence/')?'COMMERCE':null);
   if(moduleKey&&!c.modules.some(m=>m.key===moduleKey&&m.enabled))return secured(response({success:false,error:'MODULE_NOT_ENABLED',message:'此工作區尚未啟用此模組'},403));
   if(path.startsWith('/api/public/'))return secured(response({success:false,error:'公開名片分享尚未啟用'},409));
   if(!env.PLATFORM_DB)return secured(response({success:false,error:'獨立數位資料庫尚未就緒'},503));
   if(path==='/api/startup-park/borrowed-enterprises'){
    if(a.role!=='operator_owner'||c.workspace.scope_kind!=='operator')return secured(response({success:false,error:'沒有借址企業管理權限'},403));
    const q=new URLSearchParams(url.search);q.set('paged','1');q.set('limit','50');
    const result=await addressWorker.fetch(new Request(url.origin+'/api/tenants?'+q,{headers:req.headers}),env,ctx);
    return secured(result);
   }
   if(path==='/api/auth/me')return secured(response({success:true,user:{id:a.id,display_name:a.name,status:'active',is_system_admin:0},activeWorkspaceId:c.source_workspace_id,activeRole:c.source_role,memberships:[{workspace_id:c.source_workspace_id,workspace_name:c.workspace.name,role:c.source_role,status:'active'}],borrowedWorkspace:c.workspace}));
   if(path.startsWith('/api/auth/'))return secured(response({success:false,error:'請在主工作台管理登入身分'},409));
   if(path==='/api/members'||path.startsWith('/api/members/'))return secured(response({success:false,error:'操作人員與企業授權由主工作台管理'},409));
   // External services stay explicit and disabled until separately configured.
   const lineAction=/\/(publish|set-default|sync|execute|send|dispatch|probe-https|https-probe|rollback|disable|enable)(?:\/|$)/.test(path);
   const menuPublish=/^\/api\/projects\/[a-zA-Z0-9_-]+\/publish$/.test(path);
   if(menuPublish){const configured=await env.PLATFORM_DB.prepare('SELECT a.id FROM workspace_line_accounts a JOIN startup_park_menu_chat_connections c ON c.workspace_id=a.workspace_id AND c.line_account_id=a.id WHERE a.workspace_id=? AND a.webhook_enabled=1').bind(c.source_workspace_id).first();if(!configured||env.DEMO_MODE==='on')return secured(response({success:false,error:'請先啟用此工作區的聊天室修改選單 LINE 連線'},409));}
   if(lineAction&&!menuPublish&&!path.startsWith('/api/site-drafts')&&!['GET','HEAD'].includes(req.method))return secured(response({success:false,error:'外部 LINE／金流／AI 執行尚未启用；草稿與內部管理可正常使用',errorCode:'INTEGRATION_NOT_READY'},503));
   if(path==='/api/detect-layout')return secured(response({success:false,error:'AI 圖片辨識尚未串接',errorCode:'AI_NOT_CONFIGURED'},503));
   const tenant=await provisionWorkspace(env.PLATFORM_DB,c);
   if(path==='/api/startup-park/summary'){
    const tables={projects:'projects',crm_people:'crm_people',products:'commerce_products',orders:'commerce_orders',assets:'assets'};
    const counts=await env.PLATFORM_DB.batch(Object.values(tables).map(table=>env.PLATFORM_DB.prepare('SELECT COUNT(*) n FROM '+table+' WHERE workspace_id=?').bind(c.source_workspace_id)));
    return secured(response({success:true,...Object.fromEntries(Object.keys(tables).map((key,i)=>[key,Number(counts[i].results[0].n)])),integrations:{line:'not_configured',payments:'not_configured',ai:'not_configured'}}));
   }
   const menuResult=await menuChatRoute(req,env,c,path);if(menuResult){if(!['GET','HEAD'].includes(req.method))await env.DB.prepare('INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,NULL,?,?,?,?)').bind(crypto.randomUUID(),a.operator_id,c.workspace.business_id,a.id,'menu_chat_operation',JSON.stringify({workspace_id:c.workspace.id,path,status:menuResult.status}),new Date().toISOString()).run();return secured(menuResult);}
   const siteResult=await sitesRoute(req,env.PLATFORM_DB,tenant,c,path,match[1]);if(siteResult){if(!['GET','HEAD'].includes(req.method))await env.DB.prepare('INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,NULL,?,?,?,?)').bind(crypto.randomUUID(),a.operator_id,c.workspace.business_id,a.id,'platform_site_operation',JSON.stringify({workspace_id:c.workspace.id,path,status:siteResult.status}),new Date().toISOString()).run();return secured(siteResult);}
   const headers=new Headers(req.headers);headers.delete('content-length');headers.delete('authorization');headers.delete('x-workspace-id');headers.delete('cf-access-jwt-assertion');
   let body;if(!['GET','HEAD'].includes(req.method)){
    body=path==='/api/line-hub/account'?await encryptAccountBody(req,env,a.operator_id,c.source_workspace_id):req.body;
   }
   const request=new Request(url.origin+path+url.search,{method:req.method,headers,...(body?{body,duplex:'half'}:{})});
   const sourceEnv={smart_menu_db:credentialDatabase(env.PLATFORM_DB,env,a.operator_id,c.source_workspace_id),smart_menu_assets:privateAssetBucket(env.PLATFORM_DB,c.source_workspace_id),TENANT_MODE:'session',TSP_CONTEXT:tenant};
   let result=await sourceApp.fetch(request,sourceEnv,ctx||{waitUntil(){}});
   if(path==='/api/line-hub'&&req.method==='GET'&&result.ok){const d=await result.json(),connection=await env.PLATFORM_DB.prepare('SELECT c.webhook_key FROM startup_park_menu_chat_connections c JOIN workspace_line_accounts a ON a.workspace_id=c.workspace_id AND a.id=c.line_account_id WHERE c.workspace_id=? AND a.webhook_enabled=1').bind(c.source_workspace_id).first();if(d.lineAccount)d.lineAccount.webhookPath=connection?'/api/line/webhook/runtime/'+connection.webhook_key:null;result=response({...d,integrationStatus:connection?'configured':'not_configured',message:connection?'聊天室修改選單已設定；請確認 LINE Developers 的 Webhook URL 與 Use webhook':'設定已加密保存；聊天室修改選單尚未啟用'});}
   if(path==='/api/line-hub/account'&&result.ok)result=response({success:true,webhookPath:null,integrationStatus:'not_configured'});
   if(!['GET','HEAD'].includes(req.method)){
    await env.DB.prepare('INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,NULL,?,?,?,?)').bind(crypto.randomUUID(),a.operator_id,c.workspace.business_id,a.id,'platform_runtime_operation',JSON.stringify({workspace_id:c.workspace.id,method:req.method,path,status:result.status}),new Date().toISOString()).run();
   }
   return secured(result);
  }catch(e){return secured(response({success:false,error:Number.isInteger(e?.status)?e.message:'數位工作區處理失敗，請重新整理'},Number.isInteger(e?.status)?e.status:500));}
 },
 scheduled(event,env,ctx){ctx.waitUntil(menuChatMaintenance(env));return addressWorker.scheduled(event,env,ctx);}
};
