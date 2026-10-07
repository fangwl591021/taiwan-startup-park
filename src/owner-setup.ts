import type {Env} from './types.js';
import {verifyAccess} from './auth.js';
import {HttpError,fail,stmt,digest,now} from './shared.js';
type SetupEnv=Env&{INITIAL_OWNER_EMAIL_HASH?:string;OWNER_SETUP_EXPIRES_AT?:string};
const OP='tsp-primary-operator',USER='tsp-primary-owner';
export async function enrollOwner(req:Request,env:SetupEnv){
 if(env.APP_ENV!=='production'||!env.INITIAL_OWNER_EMAIL_HASH||!/^[a-f0-9]{64}$/.test(env.INITIAL_OWNER_EMAIL_HASH))fail(503,'管理員初始化尚未設定');
 const expires=Date.parse(env.OWNER_SETUP_EXPIRES_AT||'');
 if(!Number.isFinite(expires)||expires<=Date.now())fail(403,'初始化期限已到，請通知建置人員');
 if(req.headers.get('origin')!==env.APP_ORIGIN||req.headers.get('x-requested-with')!=='tsp')fail(403,'請從初始化頁面操作');
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>100)fail(400,'內容不正確');
 let body:unknown;try{body=JSON.parse(raw);}catch{fail(400,'內容不正確');}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)fail(400,'初始化不接受使用者、角色或業者欄位');
 const claim=await verifyAccess(req,env);
 if(!claim.email||await digest(claim.email.trim().toLowerCase())!==env.INITIAL_OWNER_EMAIL_HASH)fail(403,'請使用預先指定的管理員信箱登入');
 const existing=await stmt(env,'SELECT u.id,u.operator_id,u.role,u.active FROM auth_identities i JOIN staff_users u ON u.id=i.user_id WHERE i.issuer=? AND i.subject=?',claim.iss,claim.sub).first<{id:string;operator_id:string;role:string;active:number}>();
 if(existing){
  if(existing.id!==USER||existing.operator_id!==OP||existing.role!=='operator_owner'||existing.active!==1)fail(409,'已有其它身分設定，停止初始化');
  return {ok:true,already_initialized:true};
 }
 const counts=await stmt(env,'SELECT (SELECT COUNT(*) FROM operators) AS operators,(SELECT COUNT(*) FROM staff_users) AS staff,(SELECT COUNT(*) FROM auth_identities) AS identities').first<{operators:number;staff:number;identities:number}>();
 if(!counts||counts.operators||counts.staff||counts.identities)fail(409,'已有操作人員資料，不能重新初始化');
 await env.DB.batch([
  stmt(env,'INSERT INTO operators(id,name) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM operators) AND NOT EXISTS(SELECT 1 FROM staff_users) AND NOT EXISTS(SELECT 1 FROM auth_identities)',OP,'台灣創業園'),
  stmt(env,"INSERT INTO staff_users(id,operator_id,name,role,active) SELECT ?,?,?,'operator_owner',1 WHERE changes()>0",USER,OP,'平台建立者'),
  stmt(env,'INSERT INTO auth_identities(issuer,subject,user_id) SELECT ?,?,? WHERE changes()>0',claim.iss,claim.sub,USER),
  stmt(env,"INSERT INTO activity_events(id,operator_id,actor_id,action,detail,created_at) SELECT ?,?,?,'owner_initialized',?,? WHERE changes()>0",'tsp-owner-initialized',OP,USER,JSON.stringify({method:'verified_access_preapproved_email'}),now())
 ]);
 const bound=await stmt(env,'SELECT user_id FROM auth_identities WHERE issuer=? AND subject=? AND user_id=?',claim.iss,claim.sub,USER).first();
 if(!bound)fail(409,'初始化已由其它身分完成，請通知建置人員');
 return {ok:true,already_initialized:false};
}
const page='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>台灣創業園｜管理員初始化</title><link rel="stylesheet" href="/setup.css"><main><span class="brand">台灣創業園</span><h1>完成管理員身分驗證</h1><p>請使用預先指定的管理員信箱通過登入，再按下方按鈕。</p><button id="enroll">完成管理員初始化</button><p id="result" role="status"></p><small>目前為首次設定頁面。正式工作台將在身分確認後開放。LINE、金流及 AI 尚未啟用。</small></main><script src="/setup.js"></script></html>';
const js="document.querySelector('#enroll').addEventListener('click',async()=>{const b=document.querySelector('#enroll'),r=document.querySelector('#result');b.disabled=true;r.textContent='驗證中…';try{const res=await fetch('/api/setup/enroll',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'tsp'},body:'{}'});const d=await res.json();if(!res.ok)throw new Error(d.error||'驗證失敗');r.textContent='管理員初始化完成。請回到對話告訴建置人員「好了」，即可開放正式工作台。';}catch(e){r.textContent=e.message;b.disabled=false;}});";
const css='*{box-sizing:border-box}body{margin:0;background:#f5f7f8;color:#263238;font:16px/1.7 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{max-width:580px;background:white;padding:36px;border:1px solid #e1e6e7;border-radius:16px}.brand{color:#06a84f;font-weight:700}h1{font-size:26px;line-height:1.4}button{background:#06b653;color:white;border:0;border-radius:7px;padding:14px 20px;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.65}small{display:block;color:#657478;margin-top:24px}#result{font-weight:600}@media(max-width:500px){main{padding:24px}h1{font-size:23px}}';
export default {async fetch(req:Request,env:SetupEnv){
 const path=new URL(req.url).pathname;let response:Response;
 try{
  if(new URL(req.url).origin!==env.APP_ORIGIN)fail(403,'非授權服務網址');
  if(req.method==='GET'&&path==='/')response=new Response(page,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  else if(req.method==='GET'&&path==='/setup.js')response=new Response(js,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  else if(req.method==='GET'&&path==='/setup.css')response=new Response(css,{headers:{'Content-Type':'text/css; charset=utf-8'}});
  else if(req.method==='POST'&&path==='/api/setup/enroll')response=Response.json(await enrollOwner(req,env));
  else fail(404,'工作台尚未開放');
 }catch(e){response=Response.json({error:e instanceof HttpError?e.message:'初始化失敗，請通知建置人員'},{status:e instanceof HttpError?e.status:500});}
 const h=new Headers(response.headers);h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','same-origin');h.set('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers:h});
}};
