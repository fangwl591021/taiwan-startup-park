import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {configuration,TARGET} from './deployment.mjs';
export async function prepareOwnerSetup(env,resources,base,fetcher=fetch){
 if(resources.worker!=='taiwan-startup-park'||resources.hostname!==new URL(TARGET).hostname)throw new Error('初始化目標不符');
 env={...env};for(const k of ['D1_DATABASE_ID','ACCESS_ISSUER','ACCESS_AUD'])if(!env[k])env[k]=resources[k];
 const production=configuration(env,base),root='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
 async function cf(path,body){
  const r=await fetcher(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const d=await r.json();if(!r.ok||!d.success)throw new Error('初始化 Cloudflare '+path.split('?')[0]+' HTTP '+r.status+' codes '+(d.errors||[]).map(x=>x.code).join(','));return d.result;
 }
 if((await cf('/workers/subdomain')).subdomain!=='fangwl591021')throw new Error('初始化帳號不符');
 if((await cf('/d1/database/'+env.D1_DATABASE_ID)).name!=='taiwan-startup-park-prod')throw new Error('初始化資料庫不符');
 if((await cf('/access/organizations')).auth_domain!==new URL(env.ACCESS_ISSUER).hostname)throw new Error('初始化 Access 組織不符');
 const app=await cf('/access/apps/'+encodeURIComponent(resources.access_application_id));
 if(app.domain!==resources.hostname||app.aud!==env.ACCESS_AUD||app.type!=='self_hosted')throw new Error('初始化 Access 應用程式不符');
 const settings=await cf('/workers/scripts/taiwan-startup-park/settings');
 if((settings.bindings||[]).filter(b=>b.type==='d1').some(b=>b.id!==env.D1_DATABASE_ID||b.name!=='DB'))throw new Error('既有 Worker 資料庫不符');
 const query=await cf('/d1/database/'+env.D1_DATABASE_ID+'/query',{sql:"SELECT (SELECT COUNT(*) FROM operators) AS operators,(SELECT COUNT(*) FROM staff_users) AS staff,(SELECT COUNT(*) FROM auth_identities) AS identities,(SELECT COUNT(*) FROM auth_identities i JOIN staff_users u ON u.id=i.user_id WHERE i.issuer=? AND u.active=1 AND u.role='operator_owner') AS owners",params:[env.ACCESS_ISSUER]});
 if(query[0]?.success!==true||!query[0]?.results?.[0])throw new Error('初始化資料庫檢查失敗');
 const counts=query[0].results[0];
 for(const k of ['operators','staff','identities','owners'])if(!Number.isSafeInteger(counts[k])||counts[k]<0)throw new Error('初始化資料庫數量無效');
 if(counts.owners>0)return {ready:true};
 if(counts.operators||counts.staff||counts.identities)throw new Error('已有操作人員，停止首次初始化');
 const email=env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
 if(!email||email.length>254||!/^\S+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('缺少有效 INITIAL_OWNER_EMAIL Secret');
 const policyPath='/access/apps/'+encodeURIComponent(app.id)+'/policies';
 const restricted=p=>p.decision==='allow'&&p.include?.length===1&&Object.keys(p.include[0]).length===1&&p.include[0].email?.email?.toLowerCase()===email;
 let policies=await cf(policyPath);
 if(!Array.isArray(policies)||policies.some(p=>p.decision==='bypass'||(p.decision==='allow'&&!restricted(p))))throw new Error('已有較廣的 Access 通行規則，停止初始化');
 if(!policies.some(restricted)){
  await cf(policyPath,{name:'Initial project administrator',decision:'allow',precedence:1,include:[{email:{email}}],require:[],exclude:[]});
  policies=await cf(policyPath);
 }
 if(!policies.some(restricted)||policies.some(p=>p.decision==='bypass'||(p.decision==='allow'&&!restricted(p))))throw new Error('管理員限定規則驗證失敗');
 const previous=await cf('/workers/scripts/taiwan-startup-park/deployments');
 const hash=createHash('sha256').update(email).digest('hex');
 const expires=new Date(Date.now()+24*3600000).toISOString();
 const {assets,...setup}=production;
 setup.main='dist/owner-setup.js';setup.vars={...setup.vars,INITIAL_OWNER_EMAIL_HASH:hash,OWNER_SETUP_EXPIRES_AT:expires};
 return {ready:false,config:setup,report:{phase:'awaiting_owner_verified_login',target:TARGET,expires_at:expires,access_email_policy_verified:true,previous_deployments:previous.deployments||[],checked_at:new Date().toISOString()}};
}
async function main(){
 const resources=JSON.parse(await readFile('config/production-resources.json','utf8'));
 const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const result=await prepareOwnerSetup(process.env,resources,base);
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'ready='+result.ready+'\n');
 if(result.ready){console.log('正式管理員身分已綁定，繼續完整工作台部署。');return;}
 console.log('::add-mask::'+result.config.vars.INITIAL_OWNER_EMAIL_HASH);
 await writeFile('wrangler.owner-setup.json',JSON.stringify(result.config,null,2)+'\n',{mode:0o600});
 await writeFile('deployment-target-report.json',JSON.stringify(result.report,null,2)+'\n');
 console.log('已設定預先指定信箱的 Access 通行規則；待本人登入驗證，尚未授予管理員身分。');
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'首次初始化模式：發布僅含身分驗證的設定頁面。本人登入完成後，重新執行此 workflow 即可部署正式工作台。未開放任何客戶 API。\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
