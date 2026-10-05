const env=process.env;
if(!env.CLOUDFLARE_API_TOKEN||!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''))throw new Error('Cloudflare secret 缺少或帳號 ID 格式不正確');
const root='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID;
async function get(path){
 const response=await fetch(root+path,{headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)});
 let body={};try{body=await response.json();}catch{}
 return {ok:response.ok&&body.success===true,status:response.status,codes:(body.errors||[]).map(e=>e.code),result:body.result};
}
const sub=await get('/workers/subdomain');
console.log('ACCOUNT_CHECK '+JSON.stringify({ok:sub.ok,status:sub.status,codes:sub.codes,target_matches:sub.result?.subdomain==='fangwl591021'}));
if(!sub.ok||sub.result?.subdomain!=='fangwl591021')throw new Error('帳號與目標不符，停止盤點');
const settings=await get('/workers/scripts/taiwan-startup-park/settings');
console.log('WORKER_CHECK '+JSON.stringify({ok:settings.ok,status:settings.status,codes:settings.codes,bindings:(settings.result?.bindings||[]).map(b=>({name:b.name,type:b.type,...(b.type==='d1'?{id:b.id}:{})})),compatibility_date:settings.result?.compatibility_date}));
const dbs=await get('/d1/database?name=taiwan-startup-park-prod&per_page=100');
console.log('D1_CHECK '+JSON.stringify({ok:dbs.ok,status:dbs.status,codes:dbs.codes,databases:(Array.isArray(dbs.result)?dbs.result:[]).filter(d=>d.name==='taiwan-startup-park-prod').map(d=>({name:d.name,uuid:d.uuid}))}));
const org=await get('/access/organizations');
console.log('ACCESS_ORG_CHECK '+JSON.stringify({ok:org.ok,status:org.status,codes:org.codes,auth_domain:org.result?.auth_domain}));
const app=await get('/access/apps?per_page=100&page=1');
const matches=(Array.isArray(app.result)?app.result:[]).filter(a=>a.domain==='taiwan-startup-park.fangwl591021.workers.dev'||a.name==='taiwan-startup-park');
console.log('ACCESS_APP_CHECK '+JSON.stringify({ok:app.ok,status:app.status,codes:app.codes,apps:matches.map(a=>({id:a.id,name:a.name,domain:a.domain,aud:a.aud,type:a.type})),first_page_count:Array.isArray(app.result)?app.result.length:null}));
for(const a of matches){
 const policies=await get('/access/apps/'+encodeURIComponent(a.id)+'/policies');
 console.log('ACCESS_POLICY_CHECK '+JSON.stringify({ok:policies.ok,status:policies.status,codes:policies.codes,app_id:a.id,policies:(Array.isArray(policies.result)?policies.result:[]).map(p=>({id:p.id,decision:p.decision,include_count:p.include?.length||0}))}));
}
console.log('READ_ONLY_INVENTORY_COMPLETE');
