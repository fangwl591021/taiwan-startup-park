import {digitalPreview,requireDigitalPreview} from './scope.js';
import type {Actor,Env} from './types.js';
import {stmt,fail,now,uid,digest,audit} from './shared.js';
type Row=Record<string,any>;
type Access=(id:string)=>Promise<Row>;
const ownerRoles=['operator_owner'];
const financeRoles=['operator_owner','operator_finance'];
const salesRoles=['operator_owner','operator_sales'];
const serviceRoles=['operator_owner','operator_sales','operator_service'];
const financialRead=['operator_owner','operator_sales','operator_finance'];
const moduleKeys=['website','store','line','crm'];
const json=(data:unknown,status=200)=>Response.json(data,{status});
const clean=(r:Row)=>Object.fromEntries(Object.entries(r).filter(([k])=>!['request_hash','request_key'].includes(k)));
const role=(a:Actor,allowed:string[])=>{if(!allowed.includes(a.role))fail(403,'沒有此操作權限');};
function text(v:unknown,label:string,max=300,optional=false){if(typeof v!=='string'||v.length>max||!optional&&!v.trim())return fail(400,label+'格式不正確');return v.trim();}
function integer(v:unknown,label:string,min=0,max=1000000000){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)return fail(400,label+'格式不正確');return v;}
function day(v:unknown,label='日期'){const value=text(v,label,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value<'2000-01-01'||value>'2199-12-31')fail(400,label+'格式不正確');return value;}
export const taipeiDay=(time=Date.now())=>new Date(time+8*3600000).toISOString().slice(0,10);
const addDays=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function period(start:unknown,end:unknown){const s=day(start,'開始日'),e=day(end,'結束日');if(e<s)fail(400,'結束日不可早於開始日');return [s,e];}
async function body(req:Request,keys:string[]):Promise<Row>{
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'請使用 JSON');
 const raw=await req.text();if(raw.length>16000)fail(413,'內容過長');let value;
 try{value=JSON.parse(raw);}catch{return fail(400,'JSON 格式錯誤');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(400,'包含不允許的欄位');
 return value;
}
async function tenant(get:Access,id:string){const b=await get(id);if(!b.is_tenant)fail(409,'請先成交轉為租戶');return b;}
async function row(env:Env,a:Actor,table:string,biz:string,id:string){const value=await stmt(env,'SELECT * FROM '+table+' WHERE id=? AND operator_id=? AND business_id=?',id,a.operator_id,biz).first<Row>();if(!value)fail(404,'找不到可存取的紀錄');return value;}
async function commit(env:Env,commands:ReturnType<typeof stmt>[]){
 try{return await env.DB.batch(commands);}catch(error){
  const m=error instanceof Error?error.message:'';
  const known=['contract_overlap','subscription_overlap','overpayment','invalid_refund','receivable_closed','receivable_balance','subscription_unpaid'];
  if(known.some(k=>m.includes(k)))fail(409,({contract_overlap:'同據點合約期間重疊',subscription_overlap:'此功能已有重疊的有效訂閱',overpayment:'收款不可超過應收餘額',invalid_refund:'退款不可超過原收款尚未退回的金額',receivable_balance:'尚有實收餘額，不可作廢',subscription_unpaid:'訂閱應收尚未付清',receivable_closed:'應收單已作廢'} as Row)[known.find(k=>m.includes(k))!]);
  throw error;
 }
}
async function replay(env:Env,a:Actor,table:string,key:string,hash:string){
 const old=await stmt(env,'SELECT * FROM '+table+' WHERE operator_id=? AND request_key=?',a.operator_id,key).first<Row>();
 if(old&&(old.actor_id!==a.id||old.request_hash!==hash))fail(409,'請求識別碼已用於其他操作');
 return old;
}
async function create(env:Env,a:Actor,biz:string,table:string,data:Row,keyInput:unknown,action:string,gate?:{sql:string;args:unknown[]}){
 const key=text(keyInput,'請求識別碼',100),hash=await digest(JSON.stringify([a.id,biz,data]));
 const old=await replay(env,a,table,key,hash);if(old)return json(clean(old));
 const id=uid(),time=now();const values={id,operator_id:a.operator_id,business_id:biz,...data,actor_id:a.id,request_key:key,request_hash:hash,created_at:time,updated_at:time};
 const columns=Object.keys(values);
 await commit(env,[
  stmt(env,'INSERT OR IGNORE INTO '+table+'('+columns.join(',')+') SELECT '+columns.map(()=>'?').join(',')+(gate?' WHERE '+gate.sql:''),...Object.values(values),...(gate?.args||[])),
  audit(env,a,biz,null,action,{id,...(table==='subscriptions'?{module:data.module,provisioning:'not_connected'}:{})},true)
 ]);
 const saved=await replay(env,a,table,key,hash);if(!saved)fail(409,'紀錄已存在或資料已異動，請重新整理');
 return json(clean(saved),201);
}
async function change(env:Env,a:Actor,biz:string,table:string,current:Row,version:unknown,changes:Row,action:string){
 const v=integer(version,'版本',1);const columns=Object.keys(changes);
 const r=await commit(env,[
  stmt(env,'UPDATE '+table+' SET '+columns.map(k=>k+'=?').join(',')+',version=version+1,updated_at=? WHERE id=? AND operator_id=? AND business_id=? AND version=?',...Object.values(changes),now(),current.id,a.operator_id,biz,v),
  audit(env,a,biz,null,action,{id:current.id,from:current.status,...changes},true)
 ]);
 if(!r[0].meta.changes)fail(409,'紀錄已由其他人更新，請重新整理');
 return json({ok:true,version:v+1});
}
const balanceSQL="COALESCE((SELECT SUM(CASE WHEN le.direction='receipt' THEN le.amount ELSE -le.amount END) FROM ledger_entries le WHERE le.receivable_id=r.id AND le.operator_id=r.operator_id),0)";
const billView=(r:Row)=>({...clean(r),balance:r.amount-r.net_received,payment_status:r.status==='void'?'void':r.net_received===r.amount?'paid':r.net_received>0?'partial':'unpaid',overdue:r.status==='open'&&r.net_received<r.amount&&r.due_on<taipeiDay()});
async function bills(env:Env,a:Actor,biz:string){
 return (await stmt(env,'SELECT r.*,'+balanceSQL+' AS net_received FROM receivables r WHERE r.operator_id=? AND r.business_id=? ORDER BY r.created_at DESC',a.operator_id,biz).all<Row>()).results.map(billView);
}
export async function entitlements(env:Env,a:Actor,biz:string,dayNow=taipeiDay()){
 const subscriptions=(await stmt(env,'SELECT s.*,CASE WHEN s.amount=0 OR EXISTS(SELECT 1 FROM receivables r WHERE r.operator_id=s.operator_id AND r.business_id=s.business_id AND r.subscription_id=s.id AND r.kind=\'digital\' AND r.status=\'open\' AND r.amount=s.amount AND '+balanceSQL+'>=r.amount) THEN 1 ELSE 0 END AS payment_covered FROM subscriptions s WHERE s.operator_id=? AND s.business_id=? ORDER BY s.starts_on DESC,s.created_at DESC',a.operator_id,biz).all<Row>()).results;
 const rows=[];
 for(const s of subscriptions){
  const inPeriod=s.starts_on<=dayNow&&s.ends_on>=dayNow;
  const paid=!!s.payment_covered;
  const eligible=digitalPreview(env)&&inPeriod&&(s.status==='trial'||s.status==='active'&&paid);
  rows.push({subscription_id:s.id,module:s.module,plan_name:s.plan_name,status:s.status,starts_on:s.starts_on,ends_on:s.ends_on,
   period_status:dayNow<s.starts_on?'scheduled':dayNow>s.ends_on?'expired':'current',
   commercial_eligible:eligible,reason:!digitalPreview(env)?'phase_one_only':!inPeriod?'outside_period':!['active','trial'].includes(s.status)?'subscription_inactive':s.status==='active'&&!paid?'payment_required':'eligible',
   quota_limit:s.quota_limit,usage:null,provisioning_status:'not_connected',enabled:false});
 }
 return rows;
}
export async function requireEntitlement(env:Env,a:Actor,biz:string,module:string){
 requireDigitalPreview(env);
 const rights=await entitlements(env,a,biz);
 if(!rights.some(r=>r.module===module&&r.commercial_eligible))fail(403,'訂閱狀態、期間或收款尚未符合資格');
 // No module provider has been integrated. Commercial eligibility never grants fake functional access.
 fail(503,'此功能尚未串接及開通');
}
export async function operationRoute(req:Request,env:Env,a:Actor,getBusiness:Access):Promise<Response|null>{
 const url=new URL(req.url),method=req.method,path=url.pathname;
 if(path==='/api/operations/revenue-terms'){
  role(a,ownerRoles);
  if(method!=='GET')fail(409,'分潤標準尚未議定；第一期欄位留空，不計算、不結算');
  const terms=(await stmt(env,'SELECT module,status,partner_name,settlement_basis,platform_fee_amount,platform_share_bps,operator_share_bps,settlement_cycle,effective_on,agreement_reference FROM digital_revenue_terms WHERE operator_id=? ORDER BY module',a.operator_id).all<Row>()).results;
  return json({status:'unagreed',settlement_enabled:false,terms});
 }
 if(path==='/api/operations/catalog'&&method==='GET'){
  role(a,['operator_owner','operator_sales','operator_service','operator_finance']);
  const results=await env.DB.batch([
   stmt(env,'SELECT * FROM locations WHERE operator_id=? ORDER BY name',a.operator_id),
   stmt(env,'SELECT * FROM service_plans WHERE operator_id=? ORDER BY created_at DESC',a.operator_id)
  ]);
  const locations=results[0].results,plans=results[1].results;
  return json({phase:'address_only',digital_preview:digitalPreview(env),locations,plans:a.role==='operator_service'?plans.map(({amount,...p})=>p):plans});
 }
 if(path==='/api/operations/locations'&&method==='POST'){
  role(a,ownerRoles);const d=await body(req,['name','address']);const id=uid(),name=text(d.name,'據點名稱',100),address=text(d.address,'地址',300);
  await commit(env,[stmt(env,'INSERT INTO locations(id,operator_id,name,address,created_at) VALUES(?,?,?,?,?)',id,a.operator_id,name,address,now()),audit(env,a,null,null,'location_created',{id,name},true)]);
  return json({id,name,address},201);
 }
 if(path==='/api/operations/plans'&&method==='POST'){
  role(a,ownerRoles);requireDigitalPreview(env);const d=await body(req,['name','module','amount','duration_days','quota_limit']);
  const name=text(d.name,'方案名稱',100),module=text(d.module,'功能',20);
  if(!moduleKeys.includes(module))fail(400,'功能不正確');
  const amount=integer(d.amount,'單期金額'),duration=integer(d.duration_days,'期數天數',1,3660),quota=integer(d.quota_limit,'額度上限');
  const id=uid();
  await commit(env,[stmt(env,'INSERT INTO service_plans(id,operator_id,name,module,amount,duration_days,quota_limit,created_at) VALUES(?,?,?,?,?,?,?,?)',id,a.operator_id,name,module,amount,duration,quota,now()),audit(env,a,null,null,'plan_created',{id,module,amount,duration_days:duration,quota_limit:quota},true)]);
  return json({id,name,module,amount,duration_days:duration,quota_limit:quota},201);
 }
 const plan=path.match(/^\/api\/operations\/plans\/([^/]+)$/);
 if(plan&&method==='PATCH'){
  role(a,ownerRoles);requireDigitalPreview(env);const d=await body(req,['active','version']);if(typeof d.active!=='boolean')fail(400,'狀態錯誤');
  const r=await commit(env,[stmt(env,'UPDATE service_plans SET active=?,version=version+1 WHERE id=? AND operator_id=? AND version=?',d.active?1:0,plan[1],a.operator_id,integer(d.version,'版本',1)),audit(env,a,null,null,'plan_status_changed',{id:plan[1],active:d.active},true)]);
  if(!r[0].meta.changes)fail(409,'方案已異動或不存在');return json({ok:true});
 }
 const match=path.match(/^\/api\/businesses\/([^/]+)\/(operations|contracts|subscriptions|invoices|mail|tickets|entitlements)(?:\/([^/]+))?(?:\/(renew|ledger|check))?$/);
 if(!match)return null;
 const [,biz,kind,id,action]=match;const b=await tenant(getBusiness,biz);
 if(kind==='operations'&&method==='GET'&&!id){
  const none=()=>stmt(env,'SELECT NULL WHERE 0');
  const [results,rights]=await Promise.all([env.DB.batch([
   stmt(env,'SELECT c.*,l.name AS location_name,l.address FROM address_contracts c JOIN locations l ON l.id=c.location_id AND l.operator_id=c.operator_id WHERE c.operator_id=? AND c.business_id=? ORDER BY c.created_at DESC',a.operator_id,biz),
   stmt(env,'SELECT * FROM subscriptions WHERE operator_id=? AND business_id=? ORDER BY created_at DESC',a.operator_id,biz),
   serviceRoles.includes(a.role)?stmt(env,'SELECT * FROM mail_items WHERE operator_id=? AND business_id=? ORDER BY created_at DESC',a.operator_id,biz):none(),
   serviceRoles.includes(a.role)?stmt(env,'SELECT * FROM maintenance_tickets WHERE operator_id=? AND business_id=? ORDER BY created_at DESC',a.operator_id,biz):none(),
   financialRead.includes(a.role)?stmt(env,'SELECT r.*,'+balanceSQL+' AS net_received FROM receivables r WHERE r.operator_id=? AND r.business_id=? ORDER BY r.created_at DESC',a.operator_id,biz):none()
  ]),entitlements(env,a,biz)]);
  const [contracts,subs,mail,tickets,invoices]=results.map(r=>r.results);
  const visible=(r:Row)=>{const x=clean(r);if(a.role==='operator_service')delete x.amount;return x;};
  return json({business:{id:b.id,name:b.name,service_owner_id:b.service_owner_id},contracts:contracts.map(r=>({...visible(r),period_status:taipeiDay()<r.starts_on?'scheduled':taipeiDay()>r.ends_on?'expired':'current'})),subscriptions:subs.map(visible),invoices:financialRead.includes(a.role)?invoices.map(billView):null,mail:mail.map(clean),tickets:tickets.map(clean),entitlements:rights});

 }
 if(kind==='entitlements'&&method==='GET'){
  if(id&&action==='check'){if(!moduleKeys.includes(id))fail(400,'功能不正確');await requireEntitlement(env,a,biz,id);return json({enabled:false});}
  if(!id)return json(await entitlements(env,a,biz));
 }
 if(kind==='contracts'){
  if(method==='POST'&&!id){
   role(a,salesRoles);const d=await body(req,['location_id','starts_on','ends_on','amount','note','request_key']);
   const location=text(d.location_id,'據點',100),[start,end]=period(d.starts_on,d.ends_on);
   const data={location_id:location,starts_on:start,ends_on:end,amount:integer(d.amount,'合約總額'),note:text(d.note??'','備註',1000,true)};
   if(!await stmt(env,'SELECT id FROM locations WHERE id=? AND operator_id=? AND active=1',location,a.operator_id).first())fail(400,'據點不屬於本業者或已停用');
   return create(env,a,biz,'address_contracts',data,d.request_key,'contract_created');
  }
  if(id){
   const c=await row(env,a,'address_contracts',biz,id);
   if(method==='POST'&&action==='renew'){
    role(a,salesRoles);const d=await body(req,['version','starts_on','ends_on','amount','request_key']);
    const [start,end]=period(d.starts_on,d.ends_on);if(c.status==='draft'||start<=c.ends_on)fail(409,'續約須接續既有確認合約，期間不可重疊');
    return create(env,a,biz,'address_contracts',{location_id:c.location_id,starts_on:start,ends_on:end,amount:integer(d.amount,'合約總額'),renewal_of:c.id},d.request_key,'contract_renewal_created',{sql:"EXISTS(SELECT 1 FROM address_contracts WHERE id=? AND operator_id=? AND version=?)",args:[c.id,a.operator_id,integer(d.version,'版本',1)]});
   }
   if(method==='PATCH'&&!action){
    role(a,ownerRoles);const d=await body(req,['version','status','reference','note']);
    const status=text(d.status,'狀態',20);if(!(c.status==='draft'&&['active','ended'].includes(status)||c.status==='active'&&status==='ended'))fail(409,'合約狀態不可如此變更');
    const reference=text(d.reference,'確認／終止依據',300),note=text(d.note??'','備註',1000,true);
    return change(env,a,biz,'address_contracts',c,d.version,{status,reference,note},'contract_status_changed');
   }
  }
 }
 if(kind==='subscriptions'){
  if(method!=='GET')requireDigitalPreview(env);
  if(method==='POST'&&(!id||action==='renew')){
   role(a,salesRoles);const d=await body(req,id?['version','plan_id','starts_on','request_key']:['plan_id','starts_on','request_key']);
   const p=await stmt(env,'SELECT * FROM service_plans WHERE id=? AND operator_id=?',text(d.plan_id,'方案',100),a.operator_id).first<Row>();
   if(!p)fail(400,'找不到本業者方案');
   const start=day(d.starts_on,'開始日'),end=day(addDays(start,p.duration_days-1),'結束日');
   let parent:Row|null=null;
   if(id){parent=await row(env,a,'subscriptions',biz,id);if(parent.module!==p.module||start<=parent.ends_on)fail(409,'續訂功能須相同且期間不可重疊');}
   const data={plan_id:p.id,module:p.module,plan_name:p.name,amount:p.amount,quota_limit:p.quota_limit,starts_on:start,ends_on:end,...(parent?{renewal_of:parent.id}:{})};
   return create(env,a,biz,'subscriptions',data,d.request_key,'subscription_created',{sql:'EXISTS(SELECT 1 FROM service_plans WHERE id=? AND operator_id=? AND active=1 AND version=?)'+(parent?' AND EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND operator_id=? AND version=?)':''),args:[p.id,a.operator_id,p.version,...(parent?[parent.id,a.operator_id,integer(d.version,'版本',1)]:[])]});
  }
  if(id&&method==='PATCH'&&!action){
   role(a,ownerRoles);const s=await row(env,a,'subscriptions',biz,id);const d=await body(req,['version','status','note']);
   const target=text(d.status,'訂閱狀態',20),note=text(d.note,'處理原因',500);
   const transitions:Row={pending:['trial','active','cancelled'],trial:['active','paused','cancelled'],active:['paused','cancelled'],paused:['resume','cancelled'],cancelled:[]};
   if(!transitions[s.status]?.includes(target))fail(409,'訂閱狀態不可如此變更');
   const status=target==='resume'?s.resume_status:target;
   if(['trial','active'].includes(status)&&s.ends_on<taipeiDay())fail(409,'期間已過，請建立續訂');
   if(status==='active'&&!await paidForSubscription(env,a,s))fail(409,'請先完成本期數位應收款核對；訂閱與收款各自記錄');
   return change(env,a,biz,'subscriptions',s,d.version,{status,note,resume_status:target==='paused'?s.status:target==='resume'?null:s.resume_status},'subscription_status_changed');
  }
 }
 if(kind==='invoices'){
  role(a,financialRead);
  if(method==='GET'&&!id)return json(await bills(env,a,biz));
  if(method==='POST'&&!id){
   role(a,financeRoles);const d=await body(req,['kind','source_id','due_on','request_key']);
   const bucket=text(d.kind,'帳款類別',20);if(!['address','digital'].includes(bucket))fail(400,'商城商品款尚未開放，不得混入地址或數位服務款');
   if(bucket==='digital')requireDigitalPreview(env);
   const source=await row(env,a,bucket==='address'?'address_contracts':'subscriptions',biz,text(d.source_id,'來源',100));
   if(bucket==='address'&&source.status!=='active'||bucket==='digital'&&source.status==='cancelled')fail(409,'來源尚未確認或已取消');
   if(source.amount<=0)fail(400,'零元項目不需建立應收');
   const data={kind:bucket,contract_id:bucket==='address'?source.id:null,subscription_id:bucket==='digital'?source.id:null,amount:source.amount,due_on:day(d.due_on,'付款期限')};
   return create(env,a,biz,'receivables',data,d.request_key,'receivable_created',{sql:'EXISTS(SELECT 1 FROM '+(bucket==='address'?'address_contracts':'subscriptions')+' WHERE id=? AND operator_id=? AND version=?)',args:[source.id,a.operator_id,source.version]});
  }
  if(id){
   const bill=await row(env,a,'receivables',biz,id);
   if(method!=='GET'&&bill.kind==='digital')requireDigitalPreview(env);
   if(action==='ledger'&&method==='GET'){
    role(a,financeRoles);return json((await stmt(env,'SELECT le.*,u.name AS actor_name FROM ledger_entries le JOIN staff_users u ON u.id=le.actor_id WHERE le.operator_id=? AND le.business_id=? AND le.receivable_id=? ORDER BY le.created_at,le.rowid',a.operator_id,biz,id).all<Row>()).results.map(clean));
   }
   if(action==='ledger'&&method==='POST'){
    role(a,financeRoles);const d=await body(req,['version','direction','amount','refund_of','reference','request_key']);
    const direction=text(d.direction,'收退款類別',20);if(!['receipt','refund'].includes(direction))fail(400,'收退款類別錯誤');
    if(direction==='receipt'&&d.refund_of)fail(400,'收款不能指定原退款項目');
    const amount=integer(d.amount,'金額',1),reference=text(d.reference,'人工核對依據',300);
    const refund=direction==='refund'?text(d.refund_of,'原收款',100):null;
    const version=integer(d.version,'版本',1),key=text(d.request_key,'請求識別碼',100);
    const hash=await digest(JSON.stringify([a.id,biz,id,version,direction,amount,refund,reference]));
    const previous=await replay(env,a,'ledger_entries',key,hash);if(previous)return json(clean(previous));
    const entryId=uid();
    await commit(env,[
     stmt(env,"INSERT OR IGNORE INTO ledger_entries(id,operator_id,business_id,receivable_id,direction,amount,refund_of,reference,actor_id,request_key,request_hash,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM receivables WHERE id=? AND operator_id=? AND business_id=? AND version=? AND status='open')",entryId,a.operator_id,biz,id,direction,amount,refund,reference,a.id,key,hash,now(),id,a.operator_id,biz,version),
     audit(env,a,biz,null,'ledger_recorded',{id:entryId,receivable_id:id,kind:bill.kind,direction,amount,method:'manual_record_not_gateway'},true),
     stmt(env,'UPDATE receivables SET version=version+1,updated_at=? WHERE id=? AND operator_id=? AND EXISTS(SELECT 1 FROM ledger_entries WHERE id=?)',now(),id,a.operator_id,entryId)
    ]);
    const saved=await replay(env,a,'ledger_entries',key,hash);if(!saved)fail(409,'帳款版本已異動或已作廢，請重新整理');
    return json(clean(saved),201);
   }
   if(method==='PATCH'&&!action){
    role(a,financeRoles);const d=await body(req,['version','status','note']);if(d.status!=='void'||bill.status!=='open')fail(409,'僅可作廢尚未作廢的應收單');
    const net=(await stmt(env,"SELECT COALESCE(SUM(CASE WHEN direction='receipt' THEN amount ELSE -amount END),0) n FROM ledger_entries WHERE receivable_id=? AND operator_id=?",id,a.operator_id).first<Row>())?.n||0;
    if(net!==0)fail(409,'尚有實收餘額，須先核對退款');
    return change(env,a,biz,'receivables',bill,d.version,{status:'void',note:text(d.note,'作廢原因',500)},'receivable_voided');
   }
  }
 }
 if(kind==='mail'){
  role(a,serviceRoles);
  if(method==='POST'&&!id){
   const d=await body(req,['kind','description','carrier','tracking_no','request_key']);const mailKind=text(d.kind,'類型',20);if(!['letter','package'].includes(mailKind))fail(400,'類型錯誤');
   return create(env,a,biz,'mail_items',{kind:mailKind,description:text(d.description,'收件摘要',300),carrier:text(d.carrier??'','物流',100,true),tracking_no:text(d.tracking_no??'','單號',100,true)},d.request_key,'mail_received');
  }
  if(id&&method==='PATCH'&&!action){
   const m=await row(env,a,'mail_items',biz,id),d=await body(req,['version','status','handoff_reference']);
   const status=text(d.status,'收件狀態',20);const allowed:Row={received:['ready','returned'],ready:['collected','forwarded','returned'],collected:[],forwarded:[],returned:[]};
   if(!allowed[m.status]?.includes(status))fail(409,'信件／包裹狀態不可如此變更');
   const reference=text(d.handoff_reference??'','交付／退回依據',500,status==='ready');
   return change(env,a,biz,'mail_items',m,d.version,{status,handoff_reference:reference},'mail_status_changed');
  }
 }
 if(kind==='tickets'){
  role(a,serviceRoles);
  if(method==='POST'&&!id){
   const d=await body(req,['title','description','priority','request_key']),priority=text(d.priority??'normal','優先順序',20);if(!['low','normal','high'].includes(priority))fail(400,'優先順序錯誤');
   return create(env,a,biz,'maintenance_tickets',{title:text(d.title,'維運主旨',150),description:text(d.description,'需求內容',1500),priority},d.request_key,'ticket_created');
  }
  if(id&&method==='PATCH'&&!action){
   const ticket=await row(env,a,'maintenance_tickets',biz,id),d=await body(req,['version','status','resolution']);
   const status=text(d.status,'維運狀態',30);const allowed:Row={open:['in_progress','resolved'],in_progress:['resolved'],resolved:['open','closed'],closed:[]};
   if(!allowed[ticket.status]?.includes(status))fail(409,'維運狀態不可如此變更');
   const resolution=text(d.resolution??'','處理說明',1500,status==='in_progress');
   return change(env,a,biz,'maintenance_tickets',ticket,d.version,{status,resolution},'ticket_status_changed');
  }
 }
 return fail(404,'找不到此維運功能');
}
