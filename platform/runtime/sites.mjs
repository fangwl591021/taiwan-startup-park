function fail(status,message){throw Object.assign(new Error(message),{status});}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function body(req,keys){const raw=await req.text();if(raw.length>32000)fail(413,'網站資料過長');let d;try{d=JSON.parse(raw);}catch{fail(400,'JSON 格式錯誤');}if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!keys.includes(k)))fail(400,'網站資料格式錯誤');return d;}
function projection(r){return{id:r.id,name:r.name,description:r.description,social_urls:JSON.parse(r.social_urls),asset_ids:JSON.parse(r.asset_ids),asset_count:JSON.parse(r.asset_ids).length,status:r.status,version:r.version,created_at:r.created_at,updated_at:r.updated_at};}
function preview(r,workspaceRef){const d=projection(r);return '<article><h1>'+esc(d.name)+'</h1><p style="white-space:pre-wrap">'+esc(d.description||'公司介紹待補')+'</p>'+d.social_urls.map(u=>'<p><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(u)+'</a></p>').join('')+d.asset_ids.map(id=>'<img style="max-width:100%" alt="上傳的品牌素材" src="/api/platform-runtime/'+encodeURIComponent(workspaceRef)+'/api/assets/'+encodeURIComponent(id)+'">').join('')+'</article>';}
export async function sitesRoute(req,db,tenant,c,path,workspaceRef){
 if(!path.startsWith('/api/site-drafts'))return null;
 if(!c.modules.some(m=>m.key==='CORE_MENU'&&m.enabled))fail(403,'官網草稿模組尚未啟用');
 const id=path.match(/^\/api\/site-drafts\/([a-zA-Z0-9_-]+)(?:\/(confirm|publish))?$/);
 if(path==='/api/site-drafts'&&req.method==='GET'){const rows=await db.prepare('SELECT * FROM startup_park_site_drafts WHERE workspace_id=? ORDER BY updated_at DESC,id LIMIT 50').bind(tenant.workspaceId).all();return Response.json({success:true,items:rows.results.map(projection)});}
 if(path==='/api/site-drafts'&&req.method==='POST'){
  const d=await body(req,['name','description','social_urls','asset_ids']);
  if(typeof d.name!=='string'||!d.name.trim()||d.name.length>100||typeof d.description!=='string'||d.description.length>4000||!Array.isArray(d.social_urls)||d.social_urls.length>10||!Array.isArray(d.asset_ids)||d.asset_ids.length>10)fail(400,'請填寫有效網站名稱、介紹及最多十份素材／網址');
  const urls=d.social_urls.map(u=>{try{const v=new URL(u);if(v.protocol!=='https:'||v.username||v.password||v.href.length>2000)throw new Error();return v.href;}catch{fail(400,'社群連結須為有效 https 網址');}});
  const ids=[...new Set(d.asset_ids)];for(const id of ids){if(typeof id!=='string'||!await db.prepare('SELECT id FROM assets WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(id,tenant.workspaceId).first())fail(404,'找不到此工作區素材');}
  const id='site_'+crypto.randomUUID();
  await db.prepare("INSERT INTO startup_park_site_drafts(id,workspace_id,name,description,social_urls,asset_ids,status,created_by) VALUES(?,?,?,?,?,?,'draft',?)").bind(id,tenant.workspaceId,d.name.trim(),d.description,JSON.stringify(urls),JSON.stringify(ids),tenant.userId).run();
  const row=await db.prepare('SELECT * FROM startup_park_site_drafts WHERE id=? AND workspace_id=?').bind(id,tenant.workspaceId).first();return Response.json({success:true,item:projection(row),preview:preview(row,workspaceRef)},{status:201});
 }
 if(!id)fail(404,'找不到網站草稿');
 let row=await db.prepare('SELECT * FROM startup_park_site_drafts WHERE id=? AND workspace_id=?').bind(id[1],tenant.workspaceId).first();if(!row)fail(404,'找不到網站草稿');
 if(id[2]==='publish')fail(409,'官網租用與分潤待議定，正式發布尚未啟用');
 if(!id[2]&&req.method==='GET')return Response.json({success:true,item:projection(row),preview:preview(row,workspaceRef)});
 if(id[2]==='confirm'&&req.method==='POST'){const d=await body(req,['version']);if(!Number.isSafeInteger(d.version)||d.version<1)fail(400,'版本格式錯誤');const result=await db.prepare("UPDATE startup_park_site_drafts SET status='confirmed',version=version+1,confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND version=? AND status='draft'").bind(tenant.userId,id[1],tenant.workspaceId,d.version).run();if(!result.meta.changes)fail(409,'草稿版本或狀態已變更');row=await db.prepare('SELECT * FROM startup_park_site_drafts WHERE id=? AND workspace_id=?').bind(id[1],tenant.workspaceId).first();return Response.json({success:true,item:projection(row)});}
 fail(405,'此操作不支援');
}
