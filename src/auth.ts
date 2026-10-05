import type {Env,Actor} from './types.js';
import {fail,stmt,now,uid,local,digest,cookieToken} from './shared.js';
type JWK=JsonWebKey&{kid?:string};
const keys=new Map<string,{expires:number,value:JWK[]}>();
export function configured(env:Env){
 return !!env.ACCESS_AUD&&!!env.ACCESS_ISSUER&&/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)&&!!env.APP_ORIGIN&&/^https:\/\/[^/]+$/.test(env.APP_ORIGIN);
}
function decode(part:string){if(!/^[A-Za-z0-9_-]+$/.test(part))fail(401,'身分憑證無效');const s=atob(part.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
export async function verifyAccess(req:Request,env:Env):Promise<{sub:string;exp:number;iss:string;email?:string}>{
 if(!configured(env))fail(503,'正式登入尚未設定');
 if(new URL(req.url).origin!==env.APP_ORIGIN)fail(403,'非授權服務網址');
 const token=req.headers.get('cf-access-jwt-assertion')||'';
 if(token.length>16000)fail(401,'身分憑證無效');
 try{
  const parts=token.split('.');if(parts.length!==3)fail(401,'請先通過 Access 登入');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit)fail(401,'身分憑證無效');
  const seconds=Math.floor(Date.now()/1000);
  if(payload.iss!==env.ACCESS_ISSUER||!(Array.isArray(payload.aud)?payload.aud:[payload.aud]).includes(env.ACCESS_AUD)||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>200||!Number.isFinite(payload.exp)||payload.exp<=seconds||(payload.nbf!==undefined&&(!Number.isFinite(payload.nbf)||payload.nbf>seconds)))fail(401,'身分憑證無效或過期');
  const issuer=env.ACCESS_ISSUER!;
  let cached=keys.get(issuer);
  if(!cached||cached.expires<Date.now()||!cached.value.some(k=>k.kid===header.kid)){
   const response=await (env.HTTP||fetch)(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000),redirect:'manual'});
   if(!response.ok)fail(503,'身分驗證服務暫時不可用');
   const data=await response.json() as {keys:JWK[]};
   if(!Array.isArray(data.keys)||data.keys.length>10)fail(503,'身分驗證服務暫時不可用');
   cached={expires:Date.now()+300000,value:data.keys};keys.set(issuer,cached);
  }
  const jwk=cached.value.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
  if(!jwk)fail(401,'身分憑證無效');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))fail(401,'身分憑證簽章無效');
  return {sub:payload.sub,exp:payload.exp,iss:payload.iss,...(typeof payload.email==='string'&&payload.email.length<=254?{email:payload.email}:{})};
 }catch(error){if(error instanceof Error&&'status' in error)throw error;return fail(401,'身分憑證驗證失敗');}
}
export async function accessLogin(req:Request,env:Env){
 const claim=await verifyAccess(req,env);
 const user=await stmt(env,'SELECT u.id FROM auth_identities i JOIN staff_users u ON u.id=i.user_id WHERE i.issuer=? AND i.subject=? AND u.active=1',claim.iss,claim.sub).first<{id:string}>();
 if(!user)fail(403,'此身分尚未綁定有效操作人員，請聯絡管理員');
 const seconds=Math.max(0,Math.min(28800,claim.exp-Math.floor(Date.now()/1000)));
 const token=uid()+uid();
 await stmt(env,'INSERT INTO sessions(token_hash,user_id,expires_at,auth_method,issuer,subject) VALUES(?,?,?,?,?,?)',await digest(token),user.id,new Date(Date.now()+seconds*1000).toISOString(),'access',claim.iss,claim.sub).run();
 return Response.json({ok:true},{headers:{'Set-Cookie':'tsp_session='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+seconds}});
}
export async function actor(req:Request,env:Env):Promise<Actor>{
 const isLocal=local(req,env);
 if(!isLocal&&!configured(env))fail(503,'正式登入尚未設定');
 const token=cookieToken(req);if(!token)fail(401,'請先登入');
 const row=await stmt(env,'SELECT u.id,u.operator_id,u.name,u.role,u.active,s.auth_method,s.issuer,s.subject FROM sessions s JOIN staff_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',await digest(token),now()).first<Actor&{auth_method:string;issuer:string;subject:string}>();
 if(!row)fail(401,'登入已失效或帳號已停權');
 if(isLocal){if(row.auth_method!=='demo')fail(401,'登入環境不符');}
 else {
  if(row.auth_method!=='access')fail(401,'示範登入不可用於正式環境');
  const claim=await verifyAccess(req,env);
  if(claim.iss!==row.issuer||claim.sub!==row.subject)fail(401,'登入身分不符');
  const bound=await stmt(env,'SELECT user_id FROM auth_identities WHERE issuer=? AND subject=? AND user_id=?',claim.iss,claim.sub,row.id).first();
  if(!bound)fail(401,'身分綁定已失效');
 }
 return {id:row.id,operator_id:row.operator_id,name:row.name,role:row.role,active:row.active};
}
