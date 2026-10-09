-- Additive only: no tenant is automatically granted publishing authority.
CREATE TABLE rich_menu_chat_operators (
  workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL, line_user_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1, actor_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,line_account_id,line_user_id)
);
CREATE TABLE rich_menu_chat_sessions (
  workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL, line_user_id TEXT NOT NULL,
  run_id TEXT NOT NULL, phase TEXT NOT NULL, candidates_json TEXT NOT NULL DEFAULT '[]',
  snapshot_json TEXT, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,line_account_id,line_user_id)
);
CREATE TABLE rich_menu_chat_events (
  workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL, event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspace_id,line_account_id,event_id)
);
CREATE TABLE rich_menu_chat_jobs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
  project_id TEXT NOT NULL, line_user_id TEXT NOT NULL, event_id TEXT NOT NULL,
  phase TEXT NOT NULL, snapshot_json TEXT NOT NULL, old_asset_id TEXT NOT NULL,
  new_asset_id TEXT, old_menu_id TEXT NOT NULL, new_menu_id TEXT,
  progress_json TEXT, error_code TEXT, notification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id,line_account_id,event_id)
);
CREATE TABLE rich_menu_chat_leases (
  workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL, token TEXT NOT NULL,
  expires_at INTEGER NOT NULL, PRIMARY KEY(workspace_id,line_account_id)
);
CREATE TABLE rich_menu_chat_refresh_sources (
  workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL, from_menu_id TEXT NOT NULL,
  project_id TEXT NOT NULL, completed_target TEXT,
  PRIMARY KEY(workspace_id,line_account_id,from_menu_id)
);
CREATE TABLE rich_menu_chat_refresh_state (
  workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
  state_json TEXT NOT NULL, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,line_account_id)
);
CREATE TABLE rich_menu_chat_refresh_receipts (
  resume_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
  state_json TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX rich_menu_chat_jobs_scope ON rich_menu_chat_jobs(workspace_id,line_account_id,created_at);

CREATE TABLE startup_park_menu_chat_connections(workspace_id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL,webhook_key TEXT NOT NULL UNIQUE,destination TEXT NOT NULL,liff_id TEXT);
ALTER TABLE projects ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE rich_menu_sync_guards(id TEXT PRIMARY KEY);
CREATE TRIGGER menu_chat_project_revision AFTER UPDATE OF workspace_id,template_id,name,status,asset_id,page_count,updated_at,deleted_at ON projects BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER menu_chat_area_insert AFTER INSERT ON project_areas BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE id=NEW.project_id; END;
CREATE TRIGGER menu_chat_area_delete AFTER DELETE ON project_areas BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE id=OLD.project_id; END;
CREATE TRIGGER menu_chat_area_update AFTER UPDATE ON project_areas BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE id IN(OLD.project_id,NEW.project_id); END;
CREATE TRIGGER menu_chat_asset_update AFTER UPDATE OF workspace_id,storage_key,width,height,status,deleted_at ON assets BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE asset_id IN(OLD.id,NEW.id); END;
CREATE TRIGGER menu_chat_asset_delete BEFORE DELETE ON assets BEGIN UPDATE projects SET sync_revision=sync_revision+1 WHERE asset_id=OLD.id; END;
