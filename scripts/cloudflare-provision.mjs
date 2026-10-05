import {readFile,writeFile} from 'node:fs/promises';
const env=process.env,HOST='taiwan-startup-park.fangwl591021.workers.dev',NAME='taiwan-startup-park-prod';
if(!env.CLOUDFLARE_API_TOKEN||!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''))throw new Error('部署憑證或帳號格式不正確');
const root='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
async function cf(path,body){
 const r=await fetch(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 let d={};try{d=await r.json();}catch{}
 if(!r.ok||d.success!==true)throw new Error('Cloudflare '+path.split('?')[0]+' HTTP '+r.status+' codes '+(d.errors||[]).map(e=>e.code).join(','));
 return d.result;
}
if((await cf('/workers/subdomain')).subdomain!=='fangwl591021')throw new Error('非目標帳號');
const current=await cf('/workers/scripts/taiwan-startup-park/settings');
let dbs=await cf('/d1/database?name='+NAME+'&per_page=100');
let db=dbs.find(d=>d.name===NAME);
const d1=(current.bindings||[]).filter(b=>b.type==='d1');
if(d1.length&&(!db||d1.some(b=>b.id!==db.uuid||b.name!=='DB')))throw new Error('現有 Worker 使用其它資料庫，停止');
if(!db){db=await cf('/d1/database',{name:NAME});console.log('D1_CREATED '+JSON.stringify({name:db.name,uuid:db.uuid}));}
if(db.name!==NAME||!db.uuid)throw new Error('D1 建立結果不符');
const tables=await cf('/d1/database/'+db.uuid+'/query',{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'"});
if(!tables[0]?.success)throw new Error('資料庫 schema 檢查未成功');
const names=tables[0].results.map(r=>r.name);
if(names.length&&!names.includes('operators'))throw new Error('既有 schema 非本專案，不套用 migration');
const org=await cf('/access/organizations');
if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(org.auth_domain||''))throw new Error('Access 組織未就緒');
let app;for(let page=1;page<=10&&!app;page++){
 const list=await cf('/access/apps?per_page=100&page='+page);app=list.find(a=>a.domain===HOST);
 if(list.length<100)break;
}
if(!app){
 app=await cf('/access/apps',{name:'taiwan-startup-park',domain:HOST,type:'self_hosted',session_duration:'8h',app_launcher_visible:false});
 console.log('ACCESS_APPLICATION_CREATED');
}
if(app.domain!==HOST||!app.aud)throw new Error('Access 目標不符');
const policies=await cf('/access/apps/'+encodeURIComponent(app.id)+'/policies');
if(policies.some(p=>p.decision==='bypass'))throw new Error('Access 有 bypass，停止');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='taiwan-startup-park')throw new Error('Worker 名稱不符');
config.account_id=env.CLOUDFLARE_ACCOUNT_ID;
config.d1_databases=[{binding:'DB',database_name:NAME,database_id:db.uuid,migrations_dir:'migrations'}];
await writeFile('wrangler.infrastructure.json',JSON.stringify(config,null,2),{mode:0o600});
const mapping={worker:'taiwan-startup-park',hostname:HOST,D1_DATABASE_ID:db.uuid,ACCESS_ISSUER:'https://'+org.auth_domain,ACCESS_AUD:app.aud,access_application_id:app.id,allow_policy_count:policies.filter(p=>p.decision==='allow').length};
await writeFile('deployment-resources.json',JSON.stringify(mapping,null,2)+'\n');
console.log('PROJECT_RESOURCE_MAPPING '+JSON.stringify(mapping));
console.log('OWNER_IDENTITY_PENDING: no policy grants or user/role assignment performed');
