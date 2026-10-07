import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(path=':memory:'){
 const sqlite=new DatabaseSync(path);
 sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operators'").get())
  sqlite.exec(readFileSync(new URL('../migrations/0001_foundation.sql',import.meta.url),'utf8'));
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='line_connections'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0002_line_identity.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='address_contracts'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0003_tenant_operations.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='digital_revenue_terms'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0004_digital_revenue_placeholders.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='businesses_tenant_page'").get())
  sqlite.exec(readFileSync(new URL('../migrations/0005_workspace_paging_indexes.sql',import.meta.url),'utf8'));
 if(!sqlite.prepare('PRAGMA table_info(address_contracts)').all().some(c=>c.name==='term_kind')){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0006_contract_service_terms.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_mail_line_recipients'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0007_mail_line_recipients.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='line_connection_secrets'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0008_line_settings.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_settings'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0009_platform_console.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_line_login'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0010_platform_line_login.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_line_account'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0011_platform_line_account.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare('PRAGMA table_info(platform_line_account)').all().some(c=>c.name==='destination')){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0012_platform_line_webhook.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_modules'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0013_line_workspace.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='monitor_groups'").get()){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/0014_chat_monitor.sql',import.meta.url),'utf8'));sqlite.exec('COMMIT');}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 function prepare(sql,values=[]){
  const execute=()=>{const st=sqlite.prepare(sql);if(st.columns().length)return {results:st.all(...values),meta:{changes:0}};
   const r=st.run(...values);return {results:[],meta:{changes:Number(r.changes)}};};
  return {bind(...v){return prepare(sql,v);},async first(){return sqlite.prepare(sql).get(...values)??null;},
   async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){return execute();},execute};
 }
 return {sqlite,prepare,async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE');
  try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 },close(){sqlite.close();}};
}
export function seed(db){
 const s=db.sqlite;if(s.prepare('SELECT COUNT(*) n FROM operators').get().n)return;
 const insert=(sql,...values)=>s.prepare(sql).run(...values);
 const time='2026-10-04T01:00:00.000Z';
 s.exec('BEGIN');
 try{
  insert('INSERT INTO operators VALUES(?,?)','op-a','青禾商務中心（虛構）');
  insert('INSERT INTO operators VALUES(?,?)','op-b','晴川商務中心（虛構）');
  for(const [id,op,name,role] of [
   ['owner-a','op-a','管理員 · 林園長','operator_owner'],
   ['sales-a1','op-a','業務 S1 · 陳安','operator_sales'],
   ['sales-a2','op-a','業務 S2 · 李晴','operator_sales'],
   ['sales-a3','op-a','業務 S3 · 王禾','operator_sales'],
   ['service-a','op-a','維運 · 張青','operator_service'],
   ['finance-a','op-a','財務 · 周月','operator_finance'],
   ['platform','op-a','系統總管理員（虛構）','platform_admin'],
   ['business-admin','op-a','企業管理（未開放）','business_admin'],
   ['owner-b','op-b','B 業者管理員','operator_owner'],
   ['sales-b','op-b','B 業者業務','operator_sales']]){
    insert('INSERT INTO staff_users(id,operator_id,name,role) VALUES(?,?,?,?)',id,op,name,role);
  }
  const rows=[
   ['b1','op-a','日和設計工作室','o1','contact','sales-a1',36000,'確認登記需求','2026-10-05T02:00:00.000Z',0,null],
   ['b2','op-a','森嶼品牌有限公司','o2','onboarding','sales-a2',48000,'安排方案說明','2026-10-06T06:00:00.000Z',0,null],
   ['b3','op-a','小島選物有限公司','o3','billing','sales-a2',42000,'核對合約與收款','2026-10-07T02:00:00.000Z',0,null],
   ['b4','op-a','青鳥數位有限公司','o4','won','sales-a3',36000,'追蹤官網申請','2026-10-08T02:00:00.000Z',1,'service-a'],
   ['bb','op-b','B 業者隔離測試企業','ob','contact','sales-b',18000,'B 業者專用','',0,null]
  ];
  for(const [bid,op,name,oid,stage,owner,amount,next,follow,tenant,service] of rows){
   insert('INSERT INTO businesses(id,operator_id,name,is_tenant,service_owner_id,created_at) VALUES(?,?,?,?,?,?)',bid,op,name,tenant,service,time);
   insert('INSERT INTO contacts(id,operator_id,business_id,name,phone,email) VALUES(?,?,?,?,?,?)','contact-'+bid,op,bid,'示範聯絡人','0900-000-000','demo@example.invalid');
   insert('INSERT INTO opportunities(id,operator_id,business_id,title,stage,owner_id,amount,payment_status,next_action,followup_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',oid,op,bid,'借址登記與企業服務',stage,owner,amount,stage==='won'?'paid':'unpaid',next,follow,time,time);
   insert('INSERT INTO conversations(id,operator_id,business_id,opportunity_id,created_at) VALUES(?,?,?,?,?)','c-'+oid,op,bid,oid,time);
   insert('INSERT INTO messages(id,operator_id,conversation_id,direction,body,source,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)','m-'+oid,op,'c-'+oid,'in','您好，想了解借址登記和後續官網服務。這是一則虛構示範訊息。','customer','received_demo','seed-'+oid,time,time);
   insert('INSERT INTO activity_events(id,operator_id,business_id,opportunity_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?,?,?,?)','e-'+oid,op,bid,oid,op==='op-a'?'owner-a':'owner-b','fixture_created',JSON.stringify({demo:true,owner_id:owner}),time);
  }
  insert("INSERT INTO service_requests VALUES(?,?,?,?,?,'requested',?,?)",'sr1','op-a','b4','service-a','website',time,time);
  if(s.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='address_contracts'").get()){
   insert('INSERT INTO locations(id,operator_id,name,address,created_at) VALUES(?,?,?,?,?)','loc-a','op-a','青禾台北據點（虛構）','虛構示範地址，非實際登記處',time);
   insert('INSERT INTO locations(id,operator_id,name,address,created_at) VALUES(?,?,?,?,?)','loc-b','op-b','晴川據點（虛構）','B 業者虛構地址',time);
   for(const [id,op,name,module,amount,quota] of [
    ['plan-web','op-a','官網入門方案（示範）','website',1200,100],
    ['plan-crm','op-a','CRM 服務方案（示範）','crm',800,200],
    ['plan-b','op-b','B 業者示範方案','website',2000,100]
   ])insert('INSERT INTO service_plans(id,operator_id,name,module,amount,duration_days,quota_limit,created_at) VALUES(?,?,?,?,?,30,?,?)',id,op,name,module,amount,quota,time);
   insert("INSERT INTO address_contracts(id,operator_id,business_id,location_id,starts_on,ends_on,amount,status,reference,actor_id,request_key,request_hash,created_at,updated_at) VALUES('contract-demo','op-a','b4','loc-a','2026-10-01','2027-09-30',36000,'active','虛構合約台帳','owner-a','seed-contract','fixture',?,?)",time,time);
   insert("INSERT INTO subscriptions(id,operator_id,business_id,plan_id,module,plan_name,amount,quota_limit,starts_on,ends_on,actor_id,request_key,request_hash,created_at,updated_at) VALUES('sub-demo','op-a','b4','plan-web','website','官網入門方案（示範）',1200,100,'2026-10-01','2026-10-30','owner-a','seed-sub','fixture',?,?)",time,time);
   insert("INSERT INTO receivables(id,operator_id,business_id,kind,contract_id,amount,due_on,actor_id,request_key,request_hash,created_at,updated_at) VALUES('bill-address','op-a','b4','address','contract-demo',36000,'2026-10-10','owner-a','seed-bill-address','fixture',?,?)",time,time);
   insert("INSERT INTO receivables(id,operator_id,business_id,kind,subscription_id,amount,due_on,actor_id,request_key,request_hash,created_at,updated_at) VALUES('bill-digital','op-a','b4','digital','sub-demo',1200,'2026-10-05','owner-a','seed-bill-digital','fixture',?,?)",time,time);
   insert("INSERT INTO mail_items(id,operator_id,business_id,kind,description,carrier,tracking_no,actor_id,request_key,request_hash,created_at,updated_at) VALUES('mail-demo','op-a','b4','package','示範包裹，等待確認領取','示範物流','DEMO-0001','service-a','seed-mail','fixture',?,?)",time,time);
   insert("INSERT INTO maintenance_tickets(id,operator_id,business_id,title,description,priority,actor_id,request_key,request_hash,created_at,updated_at) VALUES('ticket-demo','op-a','b4','確認官網申請資料','示範需求：協助整理企業品牌素材。尚未進行 AI 建站。','normal','service-a','seed-ticket','fixture',?,?)",time,time);
  }
  s.exec('COMMIT');
 }catch(e){s.exec('ROLLBACK');throw e;}
}
