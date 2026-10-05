import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundled=await build({entryPoints:['dist/auth.js'],bundle:true,format:'esm',write:false});
const script=bundled.outputFiles[0].text+`
export default {async fetch(){
 const findings={};
 const issuer='https://runtime-test.cloudflareaccess.com';
 const env={APP_ORIGIN:'https://runtime.example.invalid',ACCESS_ISSUER:issuer,ACCESS_AUD:'test'};
 const keypair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keypair.publicKey),kid:'runtime',alg:'RS256',use:'sig'};
 const encode=v=>btoa(typeof v==='string'?v:String.fromCharCode(...v)).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
 const header=encode(JSON.stringify({alg:'RS256',kid:'runtime'}));
 const payload=encode(JSON.stringify({iss:issuer,aud:['test'],sub:'runtime-sub',exp:Math.floor(Date.now()/1000)+3600}));
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keypair.privateKey,new TextEncoder().encode(header+'.'+payload));
 const request=new Request(env.APP_ORIGIN,{headers:{'cf-access-jwt-assertion':header+'.'+payload+'.'+encode(new Uint8Array(signature))}});
 try{const claim=await verifyAccess(request,{...env,HTTP:async()=>Response.json({keys:[jwk]})});findings.runtime_verification=claim.sub==='runtime-sub'?'pass':'fail';}
 catch(e){findings.runtime_verification='fail';findings.runtime_error_name=e.name;findings.runtime_error_message=e.message;}
 try{
  const r=await fetch('https://fangwl591021.cloudflareaccess.com/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(15000)});
  findings.certs_status=r.status;
  const data=await r.json();findings.certs_key_count=Array.isArray(data.keys)?data.keys.length:0;
  for(const k of data.keys||[])await crypto.subtle.importKey('jwk',k,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  findings.certs_import='pass';
 }catch(e){findings.certs_import='fail';findings.certs_error_name=e.name;findings.certs_error_message=e.message;}
 return Response.json(findings);
}};
`;
const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-10-04'});
try{
 const response=await mf.dispatchFetch('http://localhost');
 const result=await response.json();console.log('WORKER_AUTH_RUNTIME '+JSON.stringify(result));
 assert.equal(result.runtime_verification,'pass');assert.equal(result.certs_status,200);assert(result.certs_key_count>0);assert.equal(result.certs_import,'pass');
}finally{await mf.dispose();}
