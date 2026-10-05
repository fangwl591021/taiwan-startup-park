import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const TARGET='https://taiwan-startup-park.fangwl591021.workers.dev';
export const REQUIRED=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','D1_DATABASE_ID','ACCESS_ISSUER','ACCESS_AUD'];
export function configuration(env,base){
 const missing=REQUIRED.filter(k=>!env[k]?.trim());
 if(missing.length)throw new Error('缺少部署設定：'+missing.join(', '));
 if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID))throw new Error('CLOUDFLARE_ACCOUNT_ID 格式錯誤');
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.D1_DATABASE_ID)||/^0+-0+-0+-0+-0+$/.test(env.D1_DATABASE_ID))throw new Error('D1_DATABASE_ID 必須是真實專案資料庫 ID');
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER))throw new Error('ACCESS_ISSUER 格式錯誤');
 if(!/^[a-f0-9]{64}$/i.test(env.ACCESS_AUD))throw new Error('ACCESS_AUD 格式錯誤');
 if(base.name!=='taiwan-startup-park'||base.main!=='dist/worker.js')throw new Error('部署目標不符');
 return {...base,account_id:env.CLOUDFLARE_ACCOUNT_ID,workers_dev:true,preview_urls:false,
 vars:{APP_ENV:'production',DEMO_MODE:'off',LINE_SEND_ENABLED:'off',APP_ORIGIN:TARGET,ACCESS_ISSUER:env.ACCESS_ISSUER,ACCESS_AUD:env.ACCESS_AUD},
 d1_databases:[{binding:'DB',database_name:'taiwan-startup-park-prod',database_id:env.D1_DATABASE_ID,migrations_dir:'migrations'}]};
}
export async function inspectTarget(env,fetcher=fetch){
 configuration(env,{name:'taiwan-startup-park',main:'dist/worker.js'});
 const prefix='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
 async function cf(path,body){
  const r=await fetcher(prefix+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok)throw new Error('Cloudflare 目標檢查失敗：'+path.split('?')[0]+' HTTP '+r.status);
  const d=await r.json();if(!d.success)throw new Error('Cloudflare 目標檢查未成功：'+path.split('?')[0]);return d.result;
 }
 const sub=await cf('/workers/subdomain');
 if(sub.subdomain!=='fangwl591021')throw new Error('帳號 Worker 網域與授權目標不符');
 const db=await cf('/d1/database/'+env.D1_DATABASE_ID);
 if(db.name!=='taiwan-startup-park-prod')throw new Error('DB 必須是本專案專用的 taiwan-startup-park-prod');
 const organization=await cf('/access/organizations');
 if(organization.auth_domain!==new URL(env.ACCESS_ISSUER).hostname)throw new Error('Access 組織與 issuer 不符');
 let app;
 for(let page=1;page<=10&&!app;page++){
  const rows=await cf('/access/apps?per_page=100&page='+page);
  if(!Array.isArray(rows))throw new Error('Access 應用程式回應格式錯誤');
  app=rows.find(a=>a.aud===env.ACCESS_AUD&&a.domain===new URL(TARGET).hostname);
  if(rows.length<100)break;
 }
 if(!app)throw new Error('找不到保護指定完整工作台網域的 Access application／AUD');
 const policies=await cf('/access/apps/'+encodeURIComponent(app.id)+'/policies');
 if(!Array.isArray(policies)||!policies.some(p=>p.decision==='allow')||policies.some(p=>p.decision==='bypass'))throw new Error('Access 須有 allow policy，不能對整個工作台 bypass');
 const settings=await cf('/workers/scripts/taiwan-startup-park/settings');
 const existing=(settings.bindings||[]).filter(b=>b.type==='d1');
 if(existing.some(b=>b.id!==env.D1_DATABASE_ID||b.name!=='DB'))throw new Error('既有 Worker 使用不同 D1，需先核對遷移方案');
 // Do not deploy a login screen that has no valid operator account.
 const query=await cf('/d1/database/'+env.D1_DATABASE_ID+'/query',{sql:"SELECT COUNT(*) AS n FROM auth_identities i JOIN staff_users u ON u.id=i.user_id WHERE i.issuer=? AND u.active=1 AND u.role='operator_owner'",params:[env.ACCESS_ISSUER]});
 if(!Array.isArray(query)||query[0]?.success!==true||Number(query[0]?.results?.[0]?.n)<1||!Number.isFinite(Number(query[0]?.results?.[0]?.n)))throw new Error('正式資料庫尚未有有效管理員 Access 綁定，先完成初始化');
 const deployments=await cf('/workers/scripts/taiwan-startup-park/deployments');
 return {target:TARGET,database_name:db.name,access_checked:true,operator_owner_bound:true,previous_deployments:deployments.deployments||[],checked_at:new Date().toISOString()};
}
export async function smoke(fetcher=fetch){
 const r=await fetcher(TARGET+'/api/me',{redirect:'manual',signal:AbortSignal.timeout(15000)});
 if([301,302,303,307,308].includes(r.status)){
  const location=r.headers.get('location');
  if(!location||!new URL(location,TARGET).hostname.endsWith('.cloudflareaccess.com'))throw new Error('非預期登入重新導向');
 }else if(![401,403].includes(r.status))throw new Error('未登入 API 未拒絕存取，HTTP '+r.status);
 return {unauthenticated_status:r.status,authenticated_smoke:'pending_user_sign_in'};
}
async function main(){
 const mode=process.argv[2];
 const resources=JSON.parse(await readFile('config/production-resources.json','utf8'));
 if(resources.worker!=='taiwan-startup-park'||resources.hostname!==new URL(TARGET).hostname)throw new Error('專案資源設定目標不符');
 for(const key of ['D1_DATABASE_ID','ACCESS_ISSUER','ACCESS_AUD'])if(!process.env[key])process.env[key]=resources[key];
 if(mode==='check'){
  const missing=REQUIRED.filter(k=>!process.env[k]?.trim());
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## 正式部署設定\n\n'+REQUIRED.map(k=>'- '+k+': '+(missing.includes(k)?'缺少':'已設定')).join('\n')+'\n\n不輸出設定值。建置成功不代表已部署。\n');
  const config=configuration(process.env,JSON.parse(await readFile('wrangler.jsonc','utf8')));
  await writeFile('wrangler.production.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});
  console.log('部署設定格式檢查完成；尚未修改 Cloudflare。');
 }else if(mode==='inspect'){
  const report=await inspectTarget(process.env);
  await writeFile('deployment-target-report.json',JSON.stringify(report,null,2)+'\n');
  console.log('已核對帳號、專用 D1、Access 與管理員綁定。');
 }else if(mode==='smoke'){
  const report=await smoke();console.log(JSON.stringify(report));
 }else throw new Error('模式必須為 check、inspect 或 smoke');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
