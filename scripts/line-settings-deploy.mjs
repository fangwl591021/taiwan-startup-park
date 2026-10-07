import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const HOST='taiwan-startup-park.fangwl591021.workers.dev';
const WORKER='taiwan-startup-park';
const DOMAIN=HOST+'/api/line/webhook/*';
const SECRET='LINE_CREDENTIALS_KEY';
export async function provisionLineSettings(env,config,fetcher=fetch){
 if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CLOUDFLARE_API_TOKEN)throw Error('缺少發布授權');
 if(config.name!==WORKER||config.account_id!==env.CLOUDFLARE_ACCOUNT_ID||config.vars?.APP_ORIGIN!=='https://'+HOST||config.vars?.APP_ENV!=='production'||config.vars?.LINE_SEND_ENABLED!=='off'||config.d1_databases?.length!==1||config.d1_databases[0].database_name!=='taiwan-startup-park-prod')throw Error('OA 設定資源目標不符');
 const api='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
 async function cf(path,method='GET',body){
  const r=await fetcher(api+path,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
  let d;try{d=await r.json();}catch{throw Error('OA 資源設定回應格式錯誤');}
  if(!r.ok||d.success!==true)throw Error('OA 資源設定 HTTP '+r.status);return d.result;
 }
 if((await cf('/workers/subdomain')).subdomain!=='fangwl591021')throw Error('非授權 Cloudflare 帳號');
 const dbId=config.d1_databases[0].database_id,db=await cf('/d1/database/'+dbId);
 if(db.name!=='taiwan-startup-park-prod'||db.uuid!==dbId)throw Error('非專案資料庫');
 const settings=await cf('/workers/scripts/'+WORKER+'/settings'),bindings=settings.bindings||[];
 if(bindings.filter(b=>b.type==='d1').length!==1||!bindings.some(b=>b.type==='d1'&&b.name==='DB'&&b.id===dbId))throw Error('實際資料庫綁定不符');
 const existing=bindings.find(b=>b.name===SECRET);
 if(existing&&existing.type!=='secret_text')throw Error('加密主鑰綁定類型不符');
 let keyCreated=false;
 if(!existing){
  const q=await cf('/d1/database/'+dbId+'/query','POST',{sql:'SELECT COUNT(*) AS n FROM line_connection_secrets'});
  if(q[0]?.success!==true||!q[0]?.results?.[0]||Number(q[0].results[0].n)!==0)throw Error('已有加密憑證但主鑰缺失；拒絕重建以免資料失效');
  await cf('/workers/scripts/'+WORKER+'/secrets','PUT',{name:SECRET,type:'secret_text',text:randomBytes(32).toString('base64')});
  keyCreated=true;
 }
 // A separate exact path application; never weaken the whole workspace policy.
 let rootApp,webhookApp;
 for(let page=1;page<=10;page++){
  const apps=await cf('/access/apps?per_page=100&page='+page);
  if(!Array.isArray(apps))throw Error('Access 應用程式格式錯誤');
  rootApp ||= apps.find(a=>a.domain===HOST&&a.aud===config.vars.ACCESS_AUD);
  webhookApp ||= apps.find(a=>a.domain===DOMAIN);
  if(apps.length<100)break;
 }
 if(!rootApp)throw Error('完整工作台 Access 保護不存在');
 const rootPolicies=await cf('/access/apps/'+rootApp.id+'/policies');
 if(!rootPolicies.some(p=>p.decision==='allow')||rootPolicies.some(p=>p.decision==='bypass'))throw Error('工作台登入保護不符');
 if(!webhookApp)webhookApp=await cf('/access/apps','POST',{name:'taiwan-startup-park LINE signed webhook',domain:DOMAIN,type:'self_hosted',session_duration:'8h',app_launcher_visible:false});
 if(webhookApp.domain!==DOMAIN||webhookApp.type!=='self_hosted'||webhookApp.id===rootApp.id)throw Error('Webhook 路徑應用程式不符');
 let policies=await cf('/access/apps/'+webhookApp.id+'/policies');
 if(!policies.length){await cf('/access/apps/'+webhookApp.id+'/policies','POST',{name:'LINE webhook HMAC only',decision:'bypass',include:[{everyone:{}}],exclude:[],require:[]});policies=await cf('/access/apps/'+webhookApp.id+'/policies');}
 if(policies.length!==1||policies[0].decision!=='bypass'||policies[0].include?.length!==1||!policies[0].include[0].everyone||Object.keys(policies[0].include[0]).length!==1||(policies[0].exclude||[]).length||(policies[0].require||[]).length)throw Error('Webhook 路徑政策不符，停止');
 const after=await cf('/workers/scripts/'+WORKER+'/settings');
 if(!(after.bindings||[]).some(b=>b.name===SECRET&&b.type==='secret_text'))throw Error('加密主鑰未完成保存');
 return {worker:WORKER,credential_key_present:true,key_created:keyCreated,webhook_domain:DOMAIN,webhook_app_id:webhookApp.id,root_access_unchanged:true,line_send_enabled:false};
}
export async function verifyLineBoundary(fetcher=fetch){
 const origin='https://'+HOST,checks=[];
 const webhook=await fetcher(origin+'/api/line/webhook/configuration-probe',{method:'POST',headers:{'x-line-signature':'invalid','Content-Type':'application/json'},body:'{"destination":"invalid","events":[]}',redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(![401,404,503].includes(webhook.status)||webhook.headers.get('location'))throw Error('LINE Webhook 未到達驗簽邊界或未拒絕無效請求');
 checks.push({path:'/api/line/webhook/configuration-probe',status:webhook.status,rejected:true});
 for(const path of ['/api/me','/api/line/settings','/api/line/inbox']){
  const r=await fetcher(origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  const location=r.headers.get('location');
  if(![302,303,307,308].includes(r.status)||!location||!new URL(location,origin).hostname.endsWith('.cloudflareaccess.com'))throw Error('工作台路徑 Access 保護不符');
  checks.push({path,status:r.status,access_protected:true});
 }
 return checks;
}
async function main(){
 const mode=process.argv[2];
 if(mode==='prepare'){
  const report=await provisionLineSettings(process.env,JSON.parse(await readFile('wrangler.production.json','utf8')));
  await writeFile('line-settings-resources.json',JSON.stringify(report,null,2)+'\n');
  console.log('OA_SETTINGS_RESOURCES '+JSON.stringify(report));
 }else if(mode==='verify'){
  const report={checked_at:new Date().toISOString(),checks:await verifyLineBoundary()};
  await writeFile('line-settings-boundary-report.json',JSON.stringify(report,null,2)+'\n');
  console.log('OA_SETTINGS_BOUNDARY '+JSON.stringify(report));
 }else throw Error('模式不正確');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('LINE OA 設定發布檢查失敗；請查看設定步驟，未輸出秘密值');process.exitCode=1;});
