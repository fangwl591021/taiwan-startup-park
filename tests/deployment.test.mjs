import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration,inspectTarget,smoke,TARGET} from '../scripts/deployment.mjs';
const env={CLOUDFLARE_API_TOKEN:'private-test-only',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),D1_DATABASE_ID:'11111111-2222-3333-4444-555555555555',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUD:'b'.repeat(64)};
const base={name:'taiwan-startup-park',main:'dist/worker.js',vars:{DEMO_MODE:'on',APP_ENV:'local'},d1_databases:[]};
test('deployment config rejects missing settings, placeholder DB and wrong Worker',()=>{
 assert.throws(()=>configuration({},base),/缺少部署設定/);
 assert.throws(()=>configuration({...env,D1_DATABASE_ID:'00000000-0000-0000-0000-000000000000'},base),/真實/);
 assert.throws(()=>configuration(env,{...base,name:'other-worker'}),/部署目標不符/);
 assert.throws(()=>configuration({...env,ACCESS_ISSUER:'https://evil.example'},base),/ISSUER/);
});
test('production config forces demo and LINE send off and never serializes deployment token',()=>{
 const c=configuration(env,base);assert.equal(c.vars.APP_ENV,'production');assert.equal(c.vars.DEMO_MODE,'off');assert.equal(c.vars.LINE_SEND_ENABLED,'off');
 assert.equal(c.vars.APP_ORIGIN,TARGET);assert.equal(c.workers_dev,true);assert.equal(c.preview_urls,false);
 assert(!JSON.stringify(c).includes(env.CLOUDFLARE_API_TOKEN));assert.equal(base.vars.DEMO_MODE,'on');
});
function remote(changes={}){
 return async(url,options)=>{
  const u=new URL(url);assert.equal(options.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);assert.equal(options.redirect,'error');
  let result;
  if(u.pathname.endsWith('/workers/subdomain'))result={subdomain:'fangwl591021'};
  else if(u.pathname.endsWith('/access/organizations'))result={auth_domain:'test.cloudflareaccess.com'};
  else if(u.pathname.endsWith('/access/apps'))result=[{id:'app1',aud:env.ACCESS_AUD,domain:new URL(TARGET).hostname}];
  else if(u.pathname.endsWith('/policies'))result=[{decision:'allow'}];
  else if(u.pathname.endsWith('/settings'))result={bindings:[]};
  else if(u.pathname.endsWith('/query')){assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body).params,[env.ACCESS_ISSUER]);result=[{success:true,results:[{n:1}]}];}
  else if(u.pathname.endsWith('/deployments'))result={deployments:[{id:'prior'}]};
  else result={name:'taiwan-startup-park-prod'};
  for(const [suffix,value] of Object.entries(changes))if(u.pathname.endsWith(suffix))result=value;
  return Response.json({success:true,result});
 };
}
test('target inspection rejects another account, database, bypass policy or absent owner',async()=>{
 for(const [change,message] of [
 [{'/workers/subdomain':{subdomain:'other'}},/帳號 Worker/],
 [{['/d1/database/'+env.D1_DATABASE_ID]:{name:'other-project'}},/專案專用/],
 [{'/policies':[{decision:'bypass'},{decision:'allow'}]},/bypass/],
 [{'/query':[{success:true,results:[{n:0}]}]},/管理員/],
 [{'/settings':{bindings:[{name:'DB',type:'d1',id:'other-db'}]}},/不同 D1/]
 ])await assert.rejects(inspectTarget(env,remote(change)),message);
});
test('target inspection records prior deployment without returning secrets',async()=>{
 const r=await inspectTarget(env,remote());assert.equal(r.operator_owner_bound,true);assert.equal(r.previous_deployments[0].id,'prior');assert(!JSON.stringify(r).includes(env.CLOUDFLARE_API_TOKEN));
});
test('smoke rejects public API success and unrelated redirects',async()=>{
 await assert.rejects(smoke(async()=>Response.json({data:'public'})),/未拒絕/);
 await assert.rejects(smoke(async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}})),/非預期/);
 assert.equal((await smoke(async()=>new Response(null,{status:302,headers:{location:'https://test.cloudflareaccess.com/login'}}))).authenticated_smoke,'pending_user_sign_in');
});
