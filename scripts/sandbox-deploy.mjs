import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {database,seed} from './database.mjs';
const HOST='taiwan-startup-park-demo.fangwl591021.workers.dev',WORKER='taiwan-startup-park-demo',NAME='taiwan-startup-park-demo',PROD='2c2ef714-429f-4ac2-9a4b-417a242627fb';
const env=process.env,mode=process.argv[2];
if(!env.CLOUDFLARE_API_TOKEN||!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.INITIAL_OWNER_EMAIL||''))throw new Error('測試環境部署設定缺少或格式錯誤');
const root='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
async function cf(path,body){
 const r=await fetch(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 let d={};try{d=await r.json();}catch{}
 if(!r.ok||d.success!==true)throw new Error('Sandbox Cloudflare '+path.split('?')[0]+' HTTP '+r.status+' codes '+(d.errors||[]).map(e=>e.code).join(','));
 return d.result;
}
async function query(id,sql){const rows=await cf('/d1/database/'+id+'/query',{sql});if(rows[0]?.success!==true)throw new Error('測試資料庫查詢失敗');return rows[0].results;}
async function guard(id){
 if(!id||id===PROD)throw new Error('禁止使用正式資料庫');
 const db=await cf('/d1/database/'+id);if(db.name!==NAME||db.uuid!==id)throw new Error('測試資料庫名稱不符');return db;
}
if(mode==='prepare'){
 if((await cf('/workers/subdomain')).subdomain!=='fangwl591021')throw new Error('非授權帳號');
 let db=(await cf('/d1/database?name='+NAME+'&per_page=100')).find(d=>d.name===NAME);
 if(!db)db=await cf('/d1/database',{name:NAME});
 await guard(db.uuid);
 const response=await fetch(root+'/workers/scripts/'+WORKER+'/settings',{headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(20000)});
 if(response.status!==404){const existing=await response.json();if(!response.ok||existing.success!==true)throw new Error('無法核對現有測試 Worker');
  const bindings=existing.result.bindings||[];
  const extra=bindings.find(b=>b.type==='d1'&&b.name==='PLATFORM_DB');if(extra){const source=await cf('/d1/database/'+extra.id);if(source.name!=='taiwan-startup-park-platform-demo'||extra.id===db.uuid)throw new Error('測試原平台資料庫不符');}
  if(bindings.some(b=>b.type==='d1'&&((b.name==='DB'&&b.id!==db.uuid)||!['DB','PLATFORM_DB'].includes(b.name)))||bindings.some(b=>b.type==='secret_text'&&b.name!=='SANDBOX_OWNER_EMAIL'))throw new Error('現有測試 Worker 有非預期資料庫或密鑰');
 }
 const org=await cf('/access/organizations');if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(org.auth_domain||''))throw new Error('Access 組織尚未就緒');
 let app;for(let page=1;page<=10&&!app;page++){const rows=await cf('/access/apps?per_page=100&page='+page);app=rows.find(a=>a.domain===HOST);if(rows.length<100)break;}
 if(!app)app=await cf('/access/apps',{name:WORKER,domain:HOST,type:'self_hosted',session_duration:'8h',app_launcher_visible:false});
 if(app.domain!==HOST||!app.aud||app.type!=='self_hosted')throw new Error('測試 Access application 不符');
 let policies=await cf('/access/apps/'+app.id+'/policies');
 if(!policies.length){await cf('/access/apps/'+app.id+'/policies',{name:'Only authorized simulation owner',decision:'allow',include:[{email:{email:env.INITIAL_OWNER_EMAIL}}],exclude:[],require:[]});policies=await cf('/access/apps/'+app.id+'/policies');}
 const valid=policies.length===1&&policies[0].decision==='allow'&&policies[0].include?.length===1&&policies[0].include[0].email?.email?.toLowerCase()===env.INITIAL_OWNER_EMAIL.toLowerCase()&&!(policies[0].exclude||[]).length&&!(policies[0].require||[]).length;
 if(!valid)throw new Error('測試 Access 政策不是指定管理員，停止');
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 config.name=WORKER;config.account_id=env.CLOUDFLARE_ACCOUNT_ID;config.workers_dev=true;config.preview_urls=false;
 config.assets.run_worker_first=['/api/*'];config.vars={APP_ENV:'sandbox',DEMO_MODE:'on',LINE_SEND_ENABLED:'off',APP_ORIGIN:'https://'+HOST,ACCESS_ISSUER:'https://'+org.auth_domain,ACCESS_AUD:app.aud,SANDBOX_DATABASE_ID:db.uuid};
 config.d1_databases=[{binding:'DB',database_name:NAME,database_id:db.uuid,migrations_dir:'migrations'}];delete config.triggers;
 await writeFile('wrangler.sandbox.json',JSON.stringify(config,null,2),{mode:0o600});
 await writeFile('.sandbox-secrets.json',JSON.stringify({SANDBOX_OWNER_EMAIL:env.INITIAL_OWNER_EMAIL}),{mode:0o600});
 await writeFile('sandbox-resources.json',JSON.stringify({worker:WORKER,hostname:HOST,database_id:db.uuid,access_application_id:app.id,isolated:true},null,2));
 console.log('SANDBOX_RESOURCES '+JSON.stringify({worker:WORKER,hostname:HOST,database_id:db.uuid,isolated:true}));
}else if(mode==='seed'||mode==='verify'){
 const config=JSON.parse(await readFile('wrangler.sandbox.json','utf8')),id=config.d1_databases?.[0]?.database_id;await guard(id);
 const rows=await query(id,'SELECT id FROM operators'),identities=await query(id,'SELECT COUNT(*) n FROM auth_identities');
 if(Number(identities[0].n)!==0||rows.some(r=>!['op-a','op-b'].includes(r.id)))throw new Error('測試資料庫包含非示範業者或真實身分，停止');
 if(mode==='seed'){
  if(rows.length){if(rows.length!==2||(await query(id,"SELECT id FROM staff_users WHERE id IN('owner-a','owner-b')")).length!==2)throw new Error('既有測試資料不符');
   if(env.GITHUB_OUTPUT)await appendFile(env.GITHUB_OUTPUT,'seed_required=false\n');console.log('保留既有虛構測試資料');}
  else{
   const db=database();seed(db);const statements=[];
   const quote=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
   for(const {name} of db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
    if(['sessions','auth_identities','digital_revenue_terms','platform_settings','platform_line_login','platform_line_account'].includes(name))continue;
    for(const row of db.sqlite.prepare('SELECT * FROM "'+name+'"').all())statements.push('INSERT INTO "'+name+'" ('+Object.keys(row).map(c=>'"'+c+'"').join(',')+') VALUES ('+Object.values(row).map(quote).join(',')+');');
   }
   db.close();await writeFile('.sandbox-seed.sql',statements.join('\n')+'\n',{mode:0o600});
   if(env.GITHUB_OUTPUT)await appendFile(env.GITHUB_OUTPUT,'seed_required=true\n');console.log('準備獨立虛構資料；未使用正式資料');}
 }else{
  if(rows.length!==2)throw new Error('測試業者資料未完成');
  const r=await fetch('https://'+HOST+'/api/demo/users',{redirect:'manual',signal:AbortSignal.timeout(15000)});
  const location=r.headers.get('location');
  if(![302,303,307,308].includes(r.status)||!location||!new URL(location).hostname.endsWith('.cloudflareaccess.com'))throw new Error('未登入測試 API 沒有 Access 保護');
  const bindings=(await cf('/workers/scripts/'+WORKER+'/settings')).bindings||[];
  if(bindings.filter(b=>b.type==='d1').length!==config.d1_databases.length||config.d1_databases.some(expected=>!bindings.some(b=>b.name===expected.binding&&b.type==='d1'&&b.id===expected.database_id))||bindings.some(b=>b.name==='LINE_CHANNELS_JSON'||b.name==='LINE_CHANNEL_ACCESS_TOKEN'))throw new Error('已發布 Worker 隔離檢查失敗');
  console.log('測試區部署完成：獨立 D1、限定管理員 Access、真實 LINE 外送關閉；未登入 HTTP '+r.status);
 }
}else throw new Error('模式必須為 prepare、seed 或 verify');
