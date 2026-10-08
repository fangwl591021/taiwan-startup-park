import type {Actor,Env} from './types.js';
import {stmt} from './shared.js';
import {taipeiDay} from './operations.js';

type Scope={sql:string;args:unknown[]};
/** Scope is supplied by the same server-side policy used for tenant access. */
export async function addressAttention(env:Env,a:Actor,scope:Scope,time=Date.now()){
 const today=taipeiDay(time),through=taipeiDay(time+30*86400000);
 const canFinance=['operator_owner','operator_sales','operator_finance'].includes(a.role);
 const canService=['operator_owner','operator_sales','operator_service'].includes(a.role);
 const base=' JOIN businesses b ON b.id=x.business_id AND b.operator_id=x.operator_id WHERE '+scope.sql+' AND b.is_tenant=1';
 const queries=[{
  key:'contracts',allowed:true,sql:"SELECT x.id,x.business_id,b.name AS business_name,l.name AS location_name,x.ends_on,COUNT(*) OVER() AS total FROM address_contracts x JOIN locations l ON l.id=x.location_id AND l.operator_id=x.operator_id"+base+" AND x.status='active' AND x.starts_on<=? AND x.ends_on<=? AND NOT EXISTS(SELECT 1 FROM address_contracts n WHERE n.operator_id=x.operator_id AND n.business_id=x.business_id AND n.location_id=x.location_id AND n.status='active' AND n.starts_on=date(x.ends_on,'+1 day') AND n.ends_on>x.ends_on) ORDER BY x.ends_on,x.id LIMIT 10",args:[...scope.args,today,through]
 },{
  key:'invoices',allowed:canFinance,sql:"SELECT x.id,x.business_id,b.name AS business_name,x.due_on,x.amount-COALESCE((SELECT SUM(CASE WHEN le.direction='receipt' THEN le.amount ELSE -le.amount END) FROM ledger_entries le WHERE le.receivable_id=x.id AND le.operator_id=x.operator_id),0) AS balance,COUNT(*) OVER() AS total FROM receivables x"+base+" AND x.kind='address' AND x.status='open' AND x.due_on<? AND x.amount>COALESCE((SELECT SUM(CASE WHEN le.direction='receipt' THEN le.amount ELSE -le.amount END) FROM ledger_entries le WHERE le.receivable_id=x.id AND le.operator_id=x.operator_id),0) ORDER BY x.due_on,x.id LIMIT 10",args:[...scope.args,today]
 },{
  key:'mail',allowed:canService,sql:"SELECT x.id,x.business_id,b.name AS business_name,x.kind,x.created_at,COUNT(*) OVER() AS total FROM mail_items x"+base+" AND x.status IN('received','ready') ORDER BY x.created_at,x.id LIMIT 10",args:scope.args
 },{
  key:'tickets',allowed:canService,sql:"SELECT x.id,x.business_id,b.name AS business_name,x.title,x.priority,x.status,x.created_at,COUNT(*) OVER() AS total FROM maintenance_tickets x"+base+" AND x.status IN('open','in_progress','resolved') ORDER BY CASE x.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,x.created_at,x.id LIMIT 10",args:scope.args
 }];
 const allowed=queries.filter(q=>q.allowed);
 const results=await env.DB.batch(allowed.map(q=>stmt(env,q.sql,...q.args)));
 const groups:Record<string,unknown>={};
 for(const q of queries)groups[q.key]=null;
 allowed.forEach((q,i)=>{const rows=results[i].results;groups[q.key]={total:Number(rows[0]?.total||0),items:rows.map(({total,...r})=>q.key==='contracts'?{...r,period_status:String(r.ends_on)<today?'expired':'expiring'}:r)};});
 return {as_of:today,through,limit_per_group:10,groups};
}
