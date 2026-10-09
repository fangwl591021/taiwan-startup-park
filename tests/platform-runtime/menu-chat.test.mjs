import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';

import {inspectMenuImage,readMenuImage,remapMenuAreas} from '../../platform/runtime/menu-chat/rich-menu-chat-image.mjs';
import {handleRichMenuChat,canChangeRichMenu,keywordOverlapsChangeMenu,acquireMenuLease,releaseMenuLease,processMenuRefresh,planMenuRefresh} from '../../reports/menu-chat-feature.mjs';

import {richMenuAliasIdForProject} from '../../platform/upstream-smart-menu/backend/src/project-actions.mjs';
const migration=await readFile(new URL('../../platform/runtime/menu-chat/0060_menu_chat.sql',import.meta.url),'utf8').then(s=>s.split('CREATE TABLE startup_park_menu_chat_connections')[0]);
const uid='U'+'a'.repeat(32),old='richmenu-'+'1'.repeat(32),fresh='richmenu-'+'2'.repeat(32),home='richmenu-'+'3'.repeat(32);
const png=(width=2500,height=1686)=>(()=>{const crc=data=>{let c=0xffffffff;for(const v of data){c^=v;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),out.length-4);return out;};const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(height*(width*4+1)))),chunk('IEND',Buffer.alloc(0))]);})();
class Statement{
  constructor(db,sql,values=[]){Object.assign(this,{db,sql,values});}bind(...values){return new Statement(this.db,this.sql,values);}
  async first(){const row=this.db.sqlite.prepare(this.sql).get(...this.values);return row?{...row}:null;}
  async all(){return {results:this.db.sqlite.prepare(this.sql).all(...this.values).map(row=>({...row}))};}
  async run(){return {meta:{changes:Number(this.db.sqlite.prepare(this.sql).run(...this.values).changes)}};}
}
export const schema=`CREATE TABLE workspaces(id TEXT PRIMARY KEY,status TEXT,deleted_at TEXT);
 CREATE TABLE workspace_line_accounts(id TEXT PRIMARY KEY,workspace_id TEXT,webhook_enabled INTEGER,line_bot_channel_access_token TEXT);
 CREATE TABLE workspace_module_entitlements(workspace_id TEXT,module_key TEXT,status TEXT);
 CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,status TEXT,asset_id TEXT,sync_revision INTEGER DEFAULT 0,updated_at TEXT,deleted_at TEXT);
 CREATE TABLE assets(id TEXT PRIMARY KEY,workspace_id TEXT,storage_key TEXT,original_filename TEXT,content_type TEXT,size_bytes INTEGER,width INTEGER,height INTEGER,status TEXT,created_at TEXT,deleted_at TEXT);
 CREATE TABLE project_areas(id TEXT PRIMARY KEY,project_id TEXT,workspace_id TEXT,area_index INTEGER,label TEXT,x INTEGER,y INTEGER,width INTEGER,height INTEGER,action_type TEXT,action_text TEXT,action_uri TEXT,action_data TEXT,action_display_text TEXT,target_page_id TEXT);
 CREATE TABLE rich_menu_sync_guards(id TEXT PRIMARY KEY);
 CREATE TRIGGER parent_revision AFTER UPDATE OF asset_id,updated_at,status ON projects BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE id=NEW.id;END;
 CREATE TRIGGER area_revision AFTER UPDATE ON project_areas BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE id=NEW.project_id;END;
 INSERT INTO workspaces VALUES('wa','active',NULL),('wb','active',NULL);
 INSERT INTO workspace_line_accounts VALUES('oa','wa',1,'test-a-token'),('ob','wb',1,'test-b-token');
 INSERT INTO assets VALUES('old-asset','wa','original','old.png','image/png',123,2500,1686,'ready',NULL,NULL);
 INSERT INTO projects VALUES('pa','wa','選單一','default','old-asset',0,NULL,NULL),('pb','wb','他店選單','published','other-asset',0,NULL,NULL);
 INSERT INTO project_areas VALUES('area-1','pa','wa',1,'按鈕一',0,0,1250,1686,'message','天天來簽',NULL,NULL,NULL,NULL),('area-2','pa','wa',2,'按鈕二',1250,0,1250,1686,'uri',NULL,'https://example.invalid',NULL,NULL,NULL);`;
function fixture(t,{allowed=true,isHome=true,bytes=png(),fail='',hook}={}){
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec(schema);sqlite.exec(migration);sqlite.exec("INSERT INTO workspace_module_entitlements VALUES('wa','CORE_MENU','ENABLED')");
  if(allowed)sqlite.prepare("INSERT INTO rich_menu_chat_operators(workspace_id,line_account_id,line_user_id,label,enabled,actor_id) VALUES('wa','oa',?,'管理員',1,'owner')").run(uid);
  const db={sqlite,prepare(sql){return new Statement(this,sql);},async batch(ss){sqlite.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const account={workspace_id:'wa',id:'oa',line_bot_channel_access_token:'test-a-token'},calls=[],replies=[],objects=new Map(),pushes=[],configs=new Map();
  let current=old,defaultId=isHome?old:home;
  const config={size:{width:2500,height:1686},selected:true,name:'原選單',chatBarText:'原選單按鈕',areas:[{bounds:{x:0,y:0,width:1250,height:1686},action:{type:'message',text:'天天來簽'}},{bounds:{x:1250,y:0,width:1250,height:1686},action:{type:'uri',uri:'https://example.invalid'}}]};configs.set(old,config);
  const fetcher=async(url,init={})=>{
    calls.push({url,init});assert.equal(init.headers.Authorization,'Bearer test-a-token');await hook?.(url,init,{db});
    if(url.includes('/message/')&&url.endsWith('/content'))return new Response(bytes);
    if(url.endsWith('/richmenu/alias/'+richMenuAliasIdForProject('pa'))){if(init.method==='POST'){current=JSON.parse(init.body).richMenuId;return Response.json({});}return Response.json({richMenuId:current});}
    if(url.endsWith('/user/all/richmenu'))return Response.json({richMenuId:defaultId});
    if(url.endsWith('/richmenu/'+old)&&!init.method)return Response.json({...config,richMenuId:old});
    if(url.endsWith('/richmenu/'+fresh)&&!init.method)return Response.json({...configs.get(fresh),richMenuId:fresh});
    if(url.endsWith('/richmenu')&&init.method==='POST'){if(fail==='create')throw Error('network with sensitive response');configs.set(fresh,JSON.parse(init.body));return Response.json({richMenuId:fresh});}
    if(url.endsWith('/richmenu/'+fresh+'/content'))return new Response('',{status:fail==='upload'?400:200});
    if(url.endsWith('/user/all/richmenu/'+fresh)){defaultId=fresh;return Response.json({});}
    if(url.endsWith('/message/push')){pushes.push(JSON.parse(init.body));return new Response('',{status:fail==='push'?500:200});}
    if(url.endsWith('/richmenu/validate/batch'))return Response.json({});
    if(url.endsWith('/richmenu/batch'))return new Response('',{status:202,headers:{'x-line-request-id':'batch-fixture'}});
    if(url.includes('/richmenu/progress/batch?'))return Response.json({phase:'succeeded'});
    throw Error('Unexpected '+url);
  };
  const env={smart_menu_db:db,smart_menu_assets:{async put(key,body,options){objects.set(key,{body,options});}}};
  const event=(type='text',value='修改選單',extra={})=>({type:'message',source:{type:'user',userId:uid},webhookEventId:crypto.randomUUID(),replyToken:'test-reply',message:{type,id:'msg-'+crypto.randomUUID(),...(type==='text'?{text:value}:{})},...extra});
  const turn=(e=event(),options={})=>handleRichMenuChat({env,account,event:e,signatureVerified:true,reply:async(_token,payload)=>{replies.push(payload);if(fail==='ack'&&payload.messages[0].text.includes('檢查／部署'))throw Error('ackfailed');},fetcher,...options});
  const choose=async()=>{assert.equal((await turn()).status,'CHOOSE');assert.equal((await turn(event('text','1'))).status,'UPLOAD');};
  const upload=async()=>{const r=await turn(event('file'));if(r.background)await r.background;return r;};
  return {db,env,account,event,turn,choose,upload,calls,replies,objects,pushes,configs,get current(){return current;},get defaultId(){return defaultId;}};
}
test('real byte inspector rejects spoofed, truncated, WebP, too large and invalid dimensions; accepts PNG/JPEG',()=>{
  assert.deepEqual(inspectMenuImage(png()),{width:2500,height:1686,contentType:'image/png'});
  assert.ok(inspectMenuImage(png(2500,843)));assert.ok(inspectMenuImage(png(1527,1030)));
  for(const value of [new Uint8Array(1_000_000),png().subarray(0,30),new TextEncoder().encode('image/png'),png(799,1686),png(3000,843)])assert.equal(inspectMenuImage(value),null);
  const jpg=Uint8Array.from([255,216,255,192,0,8,8,6,150,9,196,3,255,218,0,2,3,4,255,217]);
  assert.deepEqual(inspectMenuImage(jpg),{width:2500,height:1686,contentType:'image/jpeg'});
});
test('bounded stream cancels at the size limit without trusting declared MIME or size',async()=>{
  let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(1_000_000));},cancel(){cancelled=true;}});
  assert.equal(await readMenuImage('token','message',async()=>new Response(stream,{headers:{'Content-Type':'image/png','Content-Length':'3'}})),null);assert.equal(cancelled,true);
});
test('geometry scales shared edges once and preserves corrected IDs/actions; rejects aspect change and bad source bounds',()=>{
  const action={type:'message',text:'same'},areas=[{id:'a',label:'left',x:0,y:0,width:764,height:1030,action},{id:'b',label:'right',x:764,y:0,width:763,height:1030,action}];
  const mapped=remapMenuAreas(areas,{width:1527,height:1030},{width:2500,height:1686});assert.equal(mapped[0].width,mapped[1].x);assert.equal(mapped[1].x+mapped[1].width,2500);assert.equal(mapped[0].action,action);
  assert.throws(()=>remapMenuAreas(areas,{width:1527,height:1030},{width:2500,height:843}));assert.throws(()=>remapMenuAreas([{...areas[0],x:-1}],{width:1527,height:1030},{width:2500,height:1686}));
});
test('reserved keyword only overlaps exact/prefix/contains and never grants permissions',()=>{
  for(const [k,m] of [['修改選單','exact'],['修改','prefix'],['選單','contains']])assert.equal(keywordOverlapsChangeMenu(k,m),true);
  assert.equal(keywordOverlapsChangeMenu('請修改選單'),false);assert.equal(keywordOverlapsChangeMenu('', 'contains'),false);
});
test('unsigned/group/room events are silent; regular photos and numeric chat messages are not hijacked without a session',async t=>{
  const f=fixture(t);for(const source of [{type:'group',userId:uid},{type:'room',userId:uid}])assert.equal((await f.turn(f.event('text','修改選單',{source}))).handled,false);
  assert.equal((await f.turn(f.event(),{signatureVerified:false})).handled,false);assert.equal((await f.turn(f.event('image'))).handled,false);assert.equal((await f.turn(f.event('text','1'))).handled,false);assert.equal(f.replies.length,0);assert.equal(f.calls.length,0);
});
test('unlisted UID and cross-tenant UID cannot modify menus; disconnected or disabled CORE_MENU revokes authority',async t=>{
  const f=fixture(t,{allowed:false});assert.equal((await f.turn()).status,'FORBIDDEN');assert.equal(f.calls.length,0);assert.equal(f.objects.size,0);
  assert.match(f.replies[0].messages[0].text,/聊天室修改選單/);
  assert.match(f.replies[0].messages[0].text,/不需要新增後台帳號/);
  assert.ok(f.replies[0].messages[0].text.includes(uid));
  f.db.sqlite.prepare("INSERT INTO rich_menu_chat_operators(workspace_id,line_account_id,line_user_id,label,enabled,actor_id) VALUES('wb','ob',?,'other',1,'owner')").run(uid);assert.equal(await canChangeRichMenu(f.db,f.account,uid),false);
  f.db.sqlite.prepare("INSERT INTO rich_menu_chat_operators(workspace_id,line_account_id,line_user_id,label,enabled,actor_id) VALUES('wa','oa',?,'mine',1,'owner')").run(uid);assert.equal(await canChangeRichMenu(f.db,f.account,uid),true);
  f.db.sqlite.exec("UPDATE workspace_module_entitlements SET status='DISABLED' WHERE workspace_id='wa' AND module_key='CORE_MENU'");assert.equal(await canChangeRichMenu(f.db,f.account,uid),false);
});
test('home menu upload deploys once, synchronizes backend image, preserves actions, originals and default ownership',async t=>{
  const f=fixture(t);await f.choose();const before=f.db.sqlite.prepare('SELECT * FROM project_areas').all();assert.equal((await f.upload()).status,'PROCESSING');
  assert.equal(f.current,fresh);assert.equal(f.defaultId,fresh);assert.deepEqual(f.configs.get(fresh).areas,f.configs.get(old).areas);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM project_areas').all(),before);assert.notEqual(f.db.sqlite.prepare("SELECT asset_id FROM projects WHERE id='pa'").get().asset_id,'old-asset');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM assets WHERE id='old-asset'").get().n,1);assert.equal(f.objects.size,1);
  assert.equal(f.db.sqlite.prepare('SELECT phase FROM rich_menu_chat_jobs').get().phase,'succeeded');assert.equal(f.db.sqlite.prepare('SELECT notification_status FROM rich_menu_chat_jobs').get().notification_status,'suppressed');assert.equal(f.pushes.length,0);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/richmenu')&&c.init.method==='POST').length,1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM rich_menu_chat_refresh_receipts').get().n,0,'202 is not completed');
  const done=await processMenuRefresh(f.env,f.account,(...args)=>{return (async()=>{const r=f.calls;return Response.json({phase:'succeeded'});})();});assert.equal(done.phase,'succeeded');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM rich_menu_chat_refresh_receipts').get().n,1);
});
test('non-home image replacement never changes home menu or global default; alias is verified',async t=>{
  const f=fixture(t,{isHome:false});await f.choose();await f.upload();assert.equal(f.defaultId,home);assert.equal(f.current,fresh);
  assert.equal(f.calls.filter(c=>c.url.includes('/user/all/richmenu/')&&c.init.method==='POST').length,0);
});
test('2500 × 1686 upload replaces a 1527 × 1030 original using shared edges without changing actions or area IDs',async t=>{
  const f=fixture(t),original=f.configs.get(old);original.size={width:1527,height:1030};original.areas[0].bounds={x:0,y:0,width:764,height:1030};original.areas[1].bounds={x:764,y:0,width:763,height:1030};
  f.db.sqlite.exec("UPDATE assets SET width=1527,height=1030 WHERE id='old-asset';UPDATE project_areas SET width=764,height=1030 WHERE id='area-1';UPDATE project_areas SET x=764,width=763,height=1030 WHERE id='area-2'");
  await f.choose();await f.upload();assert.equal(f.current,fresh);const rows=f.db.sqlite.prepare('SELECT * FROM project_areas ORDER BY area_index').all();assert.equal(rows[0].id,'area-1');assert.equal(rows[0].action_text,'天天來簽');assert.equal(rows[0].width,rows[1].x);assert.equal(rows[1].x+rows[1].width,2500);
});
test('source edit during LINE publication cannot overwrite the newer project or areas; partial external result requires review',async t=>{
  const f=fixture(t,{hook:async(url,init,{db})=>{if(url.includes('/richmenu/alias/')&&init.method==='POST')db.sqlite.exec("UPDATE project_areas SET action_text='newer draft' WHERE id='area-1'");}});
  await f.choose();await f.upload();assert.equal(f.db.sqlite.prepare("SELECT asset_id FROM projects WHERE id='pa'").get().asset_id,'old-asset');assert.equal(f.db.sqlite.prepare("SELECT action_text FROM project_areas WHERE id='area-1'").get().action_text,'newer draft');assert.equal(f.db.sqlite.prepare('SELECT phase FROM rich_menu_chat_jobs').get().phase,'uncertain');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM rich_menu_sync_guards').get().n,0);
});
test('invalid upload leaves image/areas unchanged and permits corrected upload',async t=>{
  const f=fixture(t,{bytes:new TextEncoder().encode('not jpg')});await f.choose();await f.upload();assert.equal(f.objects.size,0);assert.equal(f.current,old);assert.equal(f.db.sqlite.prepare('SELECT phase FROM rich_menu_chat_sessions').get().phase,'upload');assert.equal(f.db.sqlite.prepare('SELECT error_code FROM rich_menu_chat_jobs').get().error_code,'IMAGE_INVALID');assert.equal(f.pushes.length,0);
});
test('stale nonce, expired session and cancel cannot select or deploy arbitrary project IDs',async t=>{
  const f=fixture(t);await f.turn();const stale=f.event('text','',{type:'postback',postback:{data:'menu-change:select?run=other&slot=0'}});assert.equal((await f.turn(stale)).status,'STALE_BUTTON');assert.equal(f.calls.length,0);
  assert.equal((await f.turn(f.event('text','取消'))).status,'CANCELLED');assert.equal((await f.turn(f.event('image'))).handled,false);
  await f.turn();f.db.sqlite.exec('UPDATE rich_menu_chat_sessions SET expires_at=0');assert.equal((await f.turn({...stale,webhookEventId:crypto.randomUUID()})).status,'EXPIRED');
});
test('redelivery and concurrent uploads create exactly one publication job and one image',async t=>{
  let release,entered;const paused=new Promise(resolve=>entered=resolve),resume=new Promise(resolve=>release=resolve);
  const f=fixture(t,{hook:async(url)=>{if(url.includes('/message/')&&url.endsWith('/content')){entered();await resume;}}});await f.choose();const event=f.event('file'),first=await f.turn(event);await paused;
  assert.equal((await f.turn(event)).status,'DUPLICATE');assert.equal((await f.turn(f.event('file'))).status,'BUSY');release();await first.background;
  assert.equal(f.objects.size,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM rich_menu_chat_jobs').get().n,1);
});
test('revocation and stale source revision abort before any LINE mutation',async t=>{
  const f=fixture(t);await f.choose();f.db.sqlite.exec("UPDATE projects SET name='edited',sync_revision=sync_revision+1 WHERE id='pa'");await f.upload();assert.equal(f.current,old);assert.equal(f.objects.size,0);assert.equal(f.db.sqlite.prepare('SELECT error_code FROM rich_menu_chat_jobs').get().error_code,'MENU_CHANGED');assert.equal(f.pushes.length,0);
  f.db.sqlite.exec('UPDATE rich_menu_chat_operators SET enabled=0');assert.equal((await f.turn()).status,'FORBIDDEN');
});
test('processing reply failure never publishes; completed jobs never push or reuse the reply token',async t=>{
  const f=fixture(t,{fail:'ack'});await f.choose();assert.equal((await f.upload()).status,'ACK_FAILED');assert.equal(f.objects.size,0);assert.equal(f.current,old);
  assert.equal(f.db.sqlite.prepare('SELECT notification_status FROM rich_menu_chat_jobs').get().notification_status,'suppressed');assert.equal(f.pushes.length,0);
  let notified=false;const g=fixture(t,{fail:'push'});await g.choose();const replyCount=g.replies.length;const started=await g.turn(g.event('file'),{notify:()=>{notified=true;}});await started.background;
  assert.equal(g.current,fresh);assert.equal(g.db.sqlite.prepare('SELECT notification_status FROM rich_menu_chat_jobs').get().notification_status,'suppressed');assert.equal(g.calls.filter(c=>c.url.endsWith('/richmenu')&&c.init.method==='POST').length,1);
  assert.equal(g.replies.length,replyCount+1);assert.equal(g.pushes.length,0);assert.equal(notified,false);assert.doesNotMatch(g.replies.at(-1).messages[0].text,/完成後會通知/);
});
test('ambiguous LINE failure is journaled and never automatically retried, cancelled or restarted',async t=>{
  const f=fixture(t,{fail:'create'});await f.choose();await f.upload();assert.equal(f.db.sqlite.prepare('SELECT phase FROM rich_menu_chat_jobs').get().phase,'uncertain');assert.equal((await f.turn()).status,'UNCERTAIN');assert.equal((await f.turn(f.event('text','取消'))).status,'UNCERTAIN');assert.equal(f.pushes.length,0);assert.equal(f.db.sqlite.prepare('SELECT notification_status FROM rich_menu_chat_jobs').get().notification_status,'suppressed');assert.doesNotMatch(JSON.stringify(f.replies),/sensitive|token/);
});
test('same-account lease is atomic, scoped and token-owned; refresh never crosses project targets or unlinks users',async t=>{
  const f=fixture(t);assert.equal(await acquireMenuLease(f.db,f.account,'one',100),true);assert.equal(await acquireMenuLease(f.db,f.account,'two',100),false);
  await releaseMenuLease(f.db,f.account,'two');assert.equal(await acquireMenuLease(f.db,f.account,'three',100),false);await releaseMenuLease(f.db,f.account,'one');assert.equal(await acquireMenuLease(f.db,f.account,'two',100),true);
  const ops=planMenuRefresh([{project_id:'a',from_menu_id:old},{project_id:'missing',from_menu_id:home},{project_id:'b',from_menu_id:home,completed_target:fresh}],new Map([['a',fresh],['b',fresh]]));assert.deepEqual(ops,[{type:'link',from:old,to:fresh}]);
});
