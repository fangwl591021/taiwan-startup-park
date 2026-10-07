const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!/^[a-f0-9]{32}$/i.test(account||''))throw new Error('Cloudflare credentials unavailable');
async function check(path){const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});let d;try{d=await r.json()}catch{};return {status:r.status,ok:r.ok&&d?.success,result:d?.result};}
const sub=await check('/workers/subdomain');if(!sub.ok||sub.result?.subdomain!=='fangwl591021')throw new Error('Wrong target account');
const db=await check('/d1/database?per_page=100');if(!db.ok)throw new Error('D1 resource inventory inaccessible');
const r2=await check('/r2/buckets');
console.log('PLATFORM_RESOURCE_PREFLIGHT '+JSON.stringify({target_verified:true,d1_read:true,platform_database_exists:db.result.some(x=>x.name==='taiwan-startup-park-platform-prod'),r2_read:r2.ok,r2_status:r2.status,platform_bucket_exists:r2.ok&&r2.result?.buckets?.some(x=>x.name==='taiwan-startup-park-platform-assets')}));
