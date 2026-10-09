import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {platformMigrationSQL} from '../../scripts/platform-migration-overlay.mjs';
const name='0033_reward_redemption_foundation.sql';
const source=await readFile('platform/upstream-smart-menu/backend/migrations/'+name,'utf8');
function trigger(sql){return sql.slice(sql.indexOf('CREATE TRIGGER IF NOT EXISTS point_redemptions_prevent_overspend'),sql.indexOf('CREATE TRIGGER IF NOT EXISTS point_redemptions_no_update')).trim();}
test('D1 trigger normalization retains point overspend enforcement and workspace scope',()=>{
 const cases=[
  {rows:[],cost:1,allowed:false},
  {rows:[['a','l','p','CREDIT',10]],cost:10,allowed:true},
  {rows:[['a','l','p','CREDIT',10],['a','l','p','DEBIT',4]],cost:7,allowed:false},
  {rows:[['a','l','p','CREDIT',10],['a','l','p','DEBIT',4]],cost:6,allowed:true},
  {rows:[['b','l','p','CREDIT',100]],cost:1,allowed:false},
  {rows:[['a','different','p','CREDIT',100]],cost:1,allowed:false},
 ];
 for(const sql of [source,platformMigrationSQL(name,source)])for(const scenario of cases){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE member_point_ledger_entries(workspace_id TEXT,line_account_id TEXT,point_account_id TEXT,entry_type TEXT,points INTEGER); CREATE TABLE point_redemptions(workspace_id TEXT,line_account_id TEXT,point_account_id TEXT,points_cost_snapshot INTEGER);'+trigger(sql));
  for(const row of scenario.rows)db.prepare('INSERT INTO member_point_ledger_entries VALUES(?,?,?,?,?)').run(...row);
  const insert=()=>db.prepare('INSERT INTO point_redemptions VALUES(?,?,?,?)').run('a','l','p',scenario.cost);
  if(scenario.allowed){insert();assert.equal(db.prepare('SELECT COUNT(*) n FROM point_redemptions').get().n,1);}
  else assert.throws(insert,/INSUFFICIENT_POINTS/);
  db.close();
 }
});
test('only the exact imported point trigger is transformed and source drift fails closed',()=>{
 assert.equal(platformMigrationSQL('other.sql',source),source);
 const normalized=platformMigrationSQL(name,source);
 assert.equal(normalized.includes("THEN RAISE(ABORT, 'INSUFFICIENT_POINTS')"),false);
 assert.ok(normalized.includes("SELECT RAISE(ABORT, 'INSUFFICIENT_POINTS');"));
 assert.throws(()=>platformMigrationSQL(name,source.replace('NEW.points_cost_snapshot','NEW.changed')),/changed/);
});
