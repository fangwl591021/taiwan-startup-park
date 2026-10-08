export async function provisionWorkspace(db,c){
 const workspaceId=c.source_workspace_id,userId='usr_tsp_'+c.actor.id;
 const revision=JSON.stringify([c.workspace.version,c.actor.name,c.source_role,c.modules.map(x=>[x.key,x.enabled,x.version])]);
 const previous=await db.prepare('SELECT revision FROM startup_park_bridge_bindings WHERE workspace_id=? AND user_id=?').bind(workspaceId,userId).first();
 if(previous?.revision===revision)return {workspaceId,userId,userRole:c.source_role};
 const statements=[
  db.prepare("INSERT INTO workspaces(id,name,slug,status,plan) VALUES(?,?,?,'active','startup-park') ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='active',updated_at=CURRENT_TIMESTAMP").bind(workspaceId,c.workspace.name,workspaceId),
  db.prepare("INSERT INTO users(id,username,display_name,status,is_system_admin) VALUES(?,?,?,'active',0) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,status='active',is_system_admin=0,updated_at=CURRENT_TIMESTAMP").bind(userId,userId,c.actor.name),
  db.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status) VALUES(?,?,?,?,'active') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',updated_at=CURRENT_TIMESTAMP").bind('wsm_tsp_'+workspaceId+'_'+userId,workspaceId,userId,c.source_role),
  ...c.modules.map(m=>db.prepare("INSERT INTO workspace_module_entitlements(id,workspace_id,module_key,status) VALUES(?,?,?,?) ON CONFLICT(workspace_id,module_key) DO UPDATE SET status=excluded.status,updated_at=CURRENT_TIMESTAMP").bind('wme_'+workspaceId+'_'+m.key,workspaceId,m.key,m.enabled?'ENABLED':'DISABLED')),
  db.prepare("INSERT OR IGNORE INTO workspace_line_accounts(id,workspace_id,oa_name,status,webhook_enabled) VALUES(?,?,?,'disconnected',0)").bind('lineacct_'+workspaceId,workspaceId,c.workspace.name),
  db.prepare("INSERT INTO startup_park_bridge_bindings(workspace_id,user_id,revision) VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET revision=excluded.revision,updated_at=CURRENT_TIMESTAMP").bind(workspaceId,userId,revision)
 ];
 await db.batch(statements);return {workspaceId,userId,userRole:c.source_role};
}
