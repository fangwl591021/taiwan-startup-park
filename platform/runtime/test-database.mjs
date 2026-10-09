import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function platformDatabase(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('platform/upstream-smart-menu/backend/migrations').filter(x=>x.endsWith('.sql')&&x!=='0007_tenant_isolation_test.sql').sort())sqlite.exec(readFileSync('platform/upstream-smart-menu/backend/migrations/'+file,'utf8'));
 sqlite.exec("DELETE FROM workspace_members WHERE user_id='usr_dev_owner'; DELETE FROM users WHERE id='usr_dev_owner'; DELETE FROM workspace_profiles WHERE workspace_id='default'; DELETE FROM workspaces WHERE id='default';");
 sqlite.exec(readFileSync('platform/runtime/schema.sql','utf8'));
 sqlite.exec(readFileSync('platform/runtime/menu-chat/0060_menu_chat.sql','utf8'));
 function prepare(sql,values=[]){
  const execute=()=>{const st=sqlite.prepare(sql);if(st.columns().length)return{success:true,results:st.all(...values),meta:{changes:0}};const r=st.run(...values);return{success:true,results:[],meta:{changes:Number(r.changes)}};};
  const bindValue=v=>v instanceof ArrayBuffer?new Uint8Array(v):v;
  return{bind(...v){return prepare(sql,v.map(bindValue));},async first(column){const r=sqlite.prepare(sql).get(...values)||null;return column?r?.[column]||null:r;},async all(){return{success:true,results:sqlite.prepare(sql).all(...values)};},async run(){return execute();},execute};
 }
 return{sqlite,prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>s.execute());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();}};
}
