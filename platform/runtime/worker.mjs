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
  if(!match)return addressWorker.fetch(req,env,ctx);
  let a,c;
  try{
   a=await actor(req,env);c=await runtimeContext(env,a,match[1]);
   const path=match[2];
   if(!path.startsWith('/api/')||/%|\/\/|\.\./.test(path)||['/api/system/','/api/member/'].some(p=>path.startsWith(p))||path==='/api/intelligence/conversions'||path==='/api/commerce/payments/newebpay/notify')return secured(response({success:false,error:'找不到可存取的操作'},404));
   if(!['GET','HEAD'].includes(req.method)&&(req.headers.get('origin')!==url.origin||req.headers.get('x-requested-with')!=='tsp'))return secured(response({success:false,error:'請从已驗證工作台操作'},403));
   if(!env.PLATFORM_DB)return secured(response({success:false,error:'獨立數位資料庫尚未就緒'},503));
   if(path==='/api/auth/me')return secured(response({success:true,user:{id:a.id,display_name:a.name,status:'active',is_system_admin:0},activeWorkspaceId:c.source_workspace_id,activeRole:c.source_role,memberships:[{workspace_id:c.source_workspace_id,workspace_name:c.workspace.name,role:c.source_role,status:'active'}],borrowedWorkspace:c.workspace}));
   if(path.startsWith('/api/auth/'))return secured(response({success:false,error:'請在主工作台管理登入身分'},409));
   if(path==='/api/members'||path.startsWith('/api/members/'))return secured(response({success:false,error:'操作人員與企業授權由主工作台管理'},409));
   // External services stay explicit and disabled until separately configured.
   const lineAction=/\/(publish|set-default|sync|execute|send|dispatch|probe-https)(?:\/|$)/.test(path);
   if(lineAction&&!path.startsWith('/api/site-drafts')&&!['GET','HEAD'].includes(req.method))return secured(response({success:false,error:'外部 LINE／金流／AI 執行尚未启用；草稿與內部管理可正常使用',errorCode:'INTEGRATION_NOT_READY'},503));
   if(path==='/api/detect-layout')return secured(response({success:false,error:'AI 圖片辨識尚未串接',errorCode:'AI_NOT_CONFIGURED'},503));
   const tenant=await provisionWorkspace(env.PLATFORM_DB,c);
   if(path==='/api/startup-park/summary'){
    const tables={projects:'projects',crm_people:'crm_people',products:'commerce_products',orders:'commerce_orders',assets:'assets'};
    const counts=await env.PLATFORM_DB.batch(Object.values(tables).map(table=>env.PLATFORM_DB.prepare('SELECT COUNT(*) n FROM '+table+' WHERE workspace_id=?').bind(c.source_workspace_id)));
    return secured(response({success:true,...Object.fromEntries(Object.keys(tables).map((key,i)=>[key,Number(counts[i].results[0].n)])),integrations:{line:'not_configured',payments:'not_configured',ai:'not_configured'}}));
   }
   const siteResult=await sitesRoute(req,env.PLATFORM_DB,tenant,c,path,match[1]);if(siteResult){if(!['GET','HEAD'].includes(req.method))await env.DB.prepare('INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,NULL,?,?,?,?)').bind(crypto.randomUUID(),a.operator_id,c.workspace.business_id,a.id,'platform_site_operation',JSON.stringify({workspace_id:c.workspace.id,path,status:siteResult.status}),new Date().toISOString()).run();return secured(siteResult);}
   const headers=new Headers(req.headers);headers.delete('authorization');headers.delete('x-workspace-id');headers.delete('cf-access-jwt-assertion');
   let body;if(!['GET','HEAD'].includes(req.method)){
    body=path==='/api/line-hub/account'?await encryptAccountBody(req,env,a.operator_id,c.source_workspace_id):req.body;
   }
   const request=new Request(url.origin+path+url.search,{method:req.method,headers,...(body?{body,duplex:'half'}:{})});
   const sourceEnv={smart_menu_db:credentialDatabase(env.PLATFORM_DB,env,a.operator_id,c.source_workspace_id),smart_menu_assets:privateAssetBucket(env.PLATFORM_DB,c.source_workspace_id),TENANT_MODE:'session',TSP_CONTEXT:tenant};
   const result=await sourceApp.fetch(request,sourceEnv,ctx||{waitUntil(){}});
   if(!['GET','HEAD'].includes(req.method)){
    await env.DB.prepare('INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,NULL,?,?,?,?)').bind(crypto.randomUUID(),a.operator_id,c.workspace.business_id,a.id,'platform_runtime_operation',JSON.stringify({workspace_id:c.workspace.id,method:req.method,path,status:result.status}),new Date().toISOString()).run();
   }
   return secured(result);
  }catch(e){return secured(response({success:false,error:Number.isInteger(e?.status)?e.message:'數位工作區處理失敗，請重新整理'},Number.isInteger(e?.status)?e.status:500));}
 },
 scheduled(event,env,ctx){return addressWorker.scheduled(event,env,ctx);}
};
