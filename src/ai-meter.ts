import type {Actor,Env} from './types.js';
import {stmt,uid,now,fail} from './shared.js';
type Usage={input?:number;output?:number;total?:number;cached?:number};
type Pricing={version:string;input:number;output:number;cached:number;billableInput?:number;billableOutput?:number;billableCached?:number};
type Execution<T>={value:T;status:'success'|'failed'|'cached'|'fallback';usage?:Usage;errorCode?:string};
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
export function costMicros(input:number,output:number,cached:number,prices:{input:number;output:number;cached:number}){
 const values=[input,output,cached,prices.input,prices.output,prices.cached];
 if(values.some(v=>integer(v)===null)||cached>input)throw new Error('Invalid AI usage/pricing');
 const n=(BigInt(input-cached)*BigInt(prices.input)+BigInt(output)*BigInt(prices.output)+BigInt(cached)*BigInt(prices.cached)+500000n)/1000000n;
 if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('AI cost overflow');return Number(n);
}
// Internal adapter only: authenticated routes cannot fabricate ledger entries or invoke arbitrary endpoints.
// Model credentials and enablement are deliberately not copied from the reference project.
export async function executeMeteredCall<T>(env:Env,a:Actor,meta:{feature:string;provider:string;model:string;pricing?:Pricing},execute:()=>Promise<Execution<T>>):Promise<T>{
 const identity=await stmt(env,'SELECT id,role FROM staff_users WHERE id=? AND operator_id=? AND active=1',a.id,a.operator_id).first();
 if(!identity||identity.role!==a.role||!['operator_owner','operator_sales','operator_service'].includes(a.role))fail(403,'AI 呼叫身分不符');
 if([meta.feature,meta.provider,meta.model].some(v=>!v||v.length>100||!/^[a-zA-Z0-9._:/-]+$/.test(v)))throw new Error('Invalid AI call metadata');
 if(meta.pricing){const p=meta.pricing;if(!p.version||p.version.length>100||[p.input,p.output,p.cached,...[p.billableInput,p.billableOutput,p.billableCached].filter(v=>v!==undefined)].some(v=>integer(v)===null))throw new Error('Invalid AI pricing snapshot');}
 const started=Date.now(),at=now();let result:Execution<T>,failure:unknown;
 try{result=await execute();if(!['success','failed','cached','fallback'].includes(result.status))throw new Error('Invalid AI result');}
 catch(error){failure=error;result={value:undefined as T,status:'failed',errorCode:'MODEL_CALL_FAILED'};}
 const u=result.usage,input=integer(u?.input),output=integer(u?.output),cached=integer(u?.cached),reported=integer(u?.total);
 const total=reported??(input!==null&&output!==null&&Number.isSafeInteger(input+output)?input+output:null);
 const p=meta.pricing,known=input!==null&&output!==null&&cached!==null&&cached<=input;
 const provider=result.status==='cached'?0:known&&p?costMicros(input!,output!,cached!,p):null;
 const billable=known&&p&&p.billableInput!==undefined&&p.billableOutput!==undefined&&p.billableCached!==undefined?
  (result.status==='success'?costMicros(input!,output!,cached!,{input:p.billableInput,output:p.billableOutput,cached:p.billableCached}):0):null;
 const code=result.errorCode&&/^[A-Z0-9_]{1,80}$/.test(result.errorCode)?result.errorCode:result.status==='failed'?'MODEL_CALL_FAILED':null;
 await stmt(env,`INSERT INTO ai_call_ledger(id,operator_id,actor_id,feature,provider,model,status,input_tokens,output_tokens,total_tokens,cached_input_tokens,
 provider_cost_micros,billable_cost_micros,currency,pricing_version,latency_ms,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
 uid(),a.operator_id,a.id,meta.feature,meta.provider,meta.model,result.status,input,output,total,cached,provider,billable,p?'USD':null,p?.version||null,Math.max(0,Date.now()-started),code,at).run();
 if(failure)throw failure;return result.value;
}
