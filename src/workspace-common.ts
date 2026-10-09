import type {Actor,Env} from './types.js';
import {fail,stmt} from './shared.js';
export const json=(d:unknown,status=200)=>Response.json(d,{status});
export function role(a:Actor,roles:string[]){if(!roles.includes(a.role))fail(403,'沒有此操作權限');}
export function text(v:unknown,label:string,max=300,empty=false){if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))fail(400,label+'格式不正確');return (v as string).trim();}
export function version(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)fail(400,'版本格式不正確');return v as number;}
export async function body(req:Request,keys:string[]){
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>16000)fail(413,'內容過長');
 let d:Record<string,unknown>;try{d=JSON.parse(raw);}catch{return fail(400,'JSON 格式錯誤');}
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!keys.includes(k)))fail(400,'包含不允許的欄位');return d;
}
export function businessScope(a:Actor,alias='b'){
 role(a,['operator_owner','operator_sales','operator_service','operator_finance']);
 if(a.role==='operator_sales')return {sql:`${alias}.operator_id=? AND (EXISTS(SELECT 1 FROM opportunities o WHERE o.operator_id=${alias}.operator_id AND o.business_id=${alias}.id AND o.owner_id=?) OR (${alias}.is_tenant=1 AND ${alias}.service_owner_id=?))`,args:[a.operator_id,a.id,a.id]};
 if(a.role==='operator_service')return {sql:`${alias}.operator_id=? AND ${alias}.is_tenant=1 AND ${alias}.service_owner_id=?`,args:[a.operator_id,a.id]};
 return {sql:alias+'.operator_id=?',args:[a.operator_id]};
}
export async function requireModule(env:Env,a:Actor,module:string){
 const row=await stmt(env,'SELECT enabled FROM workspace_modules WHERE operator_id=? AND module=?',a.operator_id,module).first<{enabled:number}>();
 if(!row?.enabled)fail(403,'此工作區尚未啟用此模組');
 if(module==='line_hub')await requireModule(env,a,'crm');
}
