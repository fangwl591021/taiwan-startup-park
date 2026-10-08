CREATE TABLE IF NOT EXISTS startup_park_bridge_bindings (
 workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,revision TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,user_id),FOREIGN KEY(workspace_id) REFERENCES workspaces(id),FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS startup_park_private_objects (
 workspace_id TEXT NOT NULL,storage_key TEXT NOT NULL,body BLOB NOT NULL CHECK(length(body)<=1048576),
 http_metadata TEXT NOT NULL,custom_metadata TEXT NOT NULL,etag TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,storage_key),FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS startup_park_site_drafts(
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,
 social_urls TEXT NOT NULL,asset_ids TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','confirmed')),
 version INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,confirmed_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id),FOREIGN KEY(created_by) REFERENCES users(id),FOREIGN KEY(confirmed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS startup_park_site_drafts_list ON startup_park_site_drafts(workspace_id,updated_at DESC,id);
