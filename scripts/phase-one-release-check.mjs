import {readFile,writeFile} from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw new Error('發布驗證缺少帳號授權');
const api='https://api.cloudflare.com/client/v4/accounts/'+account;
async function cf(path,body){
 const r=await fetch(api+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const d=await r.json();
 if(!r.ok||d.success!==true)throw new Error('發布驗證 HTTP '+r.status);
 return d.result;
}
const targets=[
 ['wrangler.production.json','taiwan-startup-park','taiwan-startup-park-prod','production','off'],
 ['wrangler.sandbox.json','taiwan-startup-park-demo','taiwan-startup-park-demo','sandbox','on']
];
const reports=[];
for(const [file,worker,databaseName,appEnv,demoMode] of targets){
 const config=JSON.parse(await readFile(file,'utf8'));
 const dbId=config.d1_databases?.[0]?.database_id;
 if(config.name!==worker||config.account_id!==account||!dbId||config.d1_databases.length!==1)throw new Error('發布目標設定不符');
 const info=await cf('/d1/database/'+dbId);
 if(info.name!==databaseName||info.uuid!==dbId)throw new Error('專用資料庫不符');
 const bindings=(await cf('/workers/scripts/'+worker+'/settings')).bindings||[];
 const plain=name=>bindings.find(b=>b.name===name&&b.type==='plain_text')?.text;
 if(bindings.filter(b=>b.type==='d1').length!==1||!bindings.some(b=>b.type==='d1'&&b.name==='DB'&&b.id===dbId))throw new Error('實際 DB binding 不符');
 if(plain('APP_ENV')!==appEnv||plain('DEMO_MODE')!==demoMode||plain('LINE_SEND_ENABLED')!=='off')throw new Error('第一期環境或外送關閉設定不符');
 const query=await cf('/d1/database/'+dbId+'/query',{sql:`SELECT
 (SELECT COUNT(*) FROM operators) AS operator_count,
 COUNT(*) AS term_count,
 COALESCE(SUM(CASE WHEN status!='unagreed' OR partner_name IS NOT NULL OR settlement_basis IS NOT NULL
 OR platform_fee_amount IS NOT NULL OR platform_share_bps IS NOT NULL OR operator_share_bps IS NOT NULL
 OR settlement_cycle IS NOT NULL OR effective_on IS NOT NULL OR agreement_reference IS NOT NULL
 THEN 1 ELSE 0 END),0) AS nonblank_count FROM digital_revenue_terms`});
 const counts=query[0]?.results?.[0];
 if(query[0]?.success!==true||!counts||Number(counts.operator_count)<1||Number(counts.term_count)!==4*Number(counts.operator_count)||Number(counts.nonblank_count)!==0)throw new Error('分潤欄位尚未全部空白或不完整');
 const url=config.vars.APP_ORIGIN;
 const r=await fetch(url+'/api/me',{redirect:'manual',signal:AbortSignal.timeout(15000)});
 const location=r.headers.get('location');
 if(![302,303,307,308].includes(r.status)||!location||!new URL(location,url).hostname.endsWith('.cloudflareaccess.com'))throw new Error('未登入工作台未受 Access 保護');
 const deployments=await cf('/workers/scripts/'+worker+'/deployments');
 const access=await cf('/d1/database/'+dbId+'/query',{sql:appEnv==='production'?"SELECT COUNT(*) n FROM platform_admin_grants g JOIN staff_users u ON u.id=g.user_id JOIN auth_identities i ON i.user_id=u.id WHERE g.active=1 AND u.active=1 AND u.id='tsp-primary-owner' AND u.operator_id='tsp-primary-operator' AND u.role='operator_owner' AND i.issuer=?":"SELECT COUNT(*) n FROM staff_users WHERE id='platform' AND role='platform_admin' AND active=1",params:appEnv==='production'?[config.vars.ACCESS_ISSUER]:[]});
 if(access[0]?.success!==true||Number(access[0]?.results?.[0]?.n)!==1)throw new Error('系統後台指定管理員權限尚未就緒');
 const settings=await cf('/d1/database/'+dbId+'/query',{sql:'SELECT COUNT(*) n FROM platform_settings WHERE id=1'});
 if(settings[0]?.success!==true||Number(settings[0]?.results?.[0]?.n)!==1)throw new Error('平台規劃設定尚未就緒');
 const login=await cf('/d1/database/'+dbId+'/query',{sql:'SELECT COUNT(*) n FROM platform_line_login WHERE id=1'});
 if(login[0]?.success!==true||Number(login[0]?.results?.[0]?.n)!==1)throw new Error('LINE Login 設定結構尚未就緒');
 reports.push({worker,database_name:databaseName,database_isolated:true,app_env:appEnv,line_send_enabled:false,revenue_terms_complete:true,revenue_values_all_null:true,settlement_enabled:false,system_admin_ready:true,platform_oa_status:'planning',unauthenticated_status:r.status,deployments:deployments.deployments||[]});
}
if(reports.length!==2)throw new Error('發布驗證不完整');
const report={source_commit:process.env.GITHUB_SHA,checked_at:new Date().toISOString(),targets:reports};
await writeFile('phase-one-release-report.json',JSON.stringify(report,null,2)+'\n');
console.log('PHASE_ONE_RELEASE_VERIFIED '+JSON.stringify(report));
