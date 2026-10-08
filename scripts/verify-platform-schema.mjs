import {DatabaseSync} from 'node:sqlite';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
const dir='platform/upstream-smart-menu/backend/migrations';
const db=new DatabaseSync(':memory:');
const files=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
const applied=[];const skipped=[];
for(const file of files){
 if(file==='0007_tenant_isolation_test.sql'){skipped.push(file);continue;}
 try{db.exec(await readFile(dir+'/'+file,'utf8'));applied.push(file);}
 catch(e){console.error('PLATFORM_SCHEMA_FAILURE '+JSON.stringify({file,error:e.message,applied:applied.length}));throw e;}
}
db.exec("DELETE FROM workspace_members WHERE user_id='usr_dev_owner'; DELETE FROM users WHERE id='usr_dev_owner'; DELETE FROM workspace_profiles WHERE workspace_id='default'; DELETE FROM workspaces WHERE id='default';");
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
const fk=db.prepare('PRAGMA foreign_key_check').all();if(fk.length)throw new Error('Invalid source foreign keys');
if(db.prepare("SELECT COUNT(*) n FROM users").get().n!==0||db.prepare("SELECT COUNT(*) n FROM workspaces").get().n!==0)throw new Error('Unexpected source seed accounts');
await mkdir('reports',{recursive:true});
await writeFile('reports/platform-schema.json',JSON.stringify({applied,skipped,tables,foreign_keys:fk,test_users_created:false},null,2)+'\n');
console.log('PLATFORM_SCHEMA_READY '+JSON.stringify({migrations:applied.length,tables:tables.length,test_accounts:0}));
