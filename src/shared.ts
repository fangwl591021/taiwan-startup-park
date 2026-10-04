import type {Env,Actor,Statement} from './types.js';
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export function fail(status:number,message:string):never{throw new HttpError(status,message);}
export const now=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();
export const stmt=(env:Env,sql:string,...args:unknown[])=>env.DB.prepare(sql).bind(...args);
export const local=(req:Request,env:Env)=>env.APP_ENV==='local'&&env.DEMO_MODE==='on'&&['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname);
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function cookieToken(req:Request){return req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('tsp_session='))?.slice(12)||'';}
export function audit(env:Env,a:Actor,businessId:string|null,opportunityId:string|null,action:string,detail:unknown,conditional=false):Statement{
 const sql=conditional?'INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0':'INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?,?,?,?)';
 return stmt(env,sql,uid(),a.operator_id,businessId,opportunityId,a.id,action,JSON.stringify(detail),now());
}
