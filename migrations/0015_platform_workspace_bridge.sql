-- Additive bridge only. Upstream migrations/resources are NOT applied here.
PRAGMA foreign_keys=ON;
CREATE TABLE platform_workspaces(
 id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL REFERENCES operators(id),
 scope_kind TEXT NOT NULL CHECK(scope_kind IN('operator','business')),
 business_id TEXT,
 source_workspace_id TEXT NOT NULL UNIQUE CHECK(source_workspace_id!='default'),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((scope_kind='operator' AND business_id IS NULL) OR (scope_kind='business' AND business_id IS NOT NULL)),
 UNIQUE(operator_id,id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id)
);
CREATE UNIQUE INDEX platform_workspace_operator ON platform_workspaces(operator_id) WHERE scope_kind='operator';
CREATE UNIQUE INDEX platform_workspace_business ON platform_workspaces(operator_id,business_id) WHERE scope_kind='business';
CREATE INDEX platform_workspace_page ON platform_workspaces(operator_id,updated_at DESC,id DESC);
CREATE TRIGGER platform_workspace_identity_fixed BEFORE UPDATE OF id,operator_id,scope_kind,business_id,source_workspace_id ON platform_workspaces
 WHEN NEW.id IS NOT OLD.id OR NEW.operator_id IS NOT OLD.operator_id OR NEW.scope_kind IS NOT OLD.scope_kind
 OR NEW.business_id IS NOT OLD.business_id OR NEW.source_workspace_id IS NOT OLD.source_workspace_id
 BEGIN SELECT RAISE(ABORT,'workspace_identity_immutable'); END;

CREATE TABLE platform_workspace_entitlements(
 operator_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN('CORE_MENU','CRM','CAMPAIGN','COMMERCE','TRAVEL','DEALER_COMMISSION','POINTS_REWARDS','AI')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,module),
 FOREIGN KEY(operator_id,workspace_id) REFERENCES platform_workspaces(operator_id,id)
);
-- Explicitly persist all eight grants. Never inherit upstream legacy "all enabled".
CREATE TRIGGER platform_workspace_grants AFTER INSERT ON platform_workspaces BEGIN
 INSERT INTO platform_workspace_entitlements(operator_id,workspace_id,module,enabled,updated_at) VALUES
 (NEW.operator_id,NEW.id,'CORE_MENU',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'CRM',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'CAMPAIGN',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'COMMERCE',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'TRAVEL',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'DEALER_COMMISSION',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'POINTS_REWARDS',0,NEW.created_at),
 (NEW.operator_id,NEW.id,'AI',0,NEW.created_at);
END;
CREATE TRIGGER platform_workspace_new_operator AFTER INSERT ON operators BEGIN
 INSERT INTO platform_workspaces(id,operator_id,scope_kind,source_workspace_id,created_at,updated_at)
 VALUES('pw-op-'||NEW.id,NEW.id,'operator','tsp-operator-'||NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER platform_workspace_new_tenant AFTER INSERT ON businesses WHEN NEW.is_tenant=1 BEGIN
 INSERT INTO platform_workspaces(id,operator_id,scope_kind,business_id,source_workspace_id,created_at,updated_at)
 VALUES('pw-biz-'||NEW.id,NEW.operator_id,'business',NEW.id,'tsp-business-'||NEW.id,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER platform_workspace_converted_tenant AFTER UPDATE OF is_tenant ON businesses WHEN NEW.is_tenant=1 BEGIN
 INSERT INTO platform_workspaces(id,operator_id,scope_kind,business_id,source_workspace_id,created_at,updated_at)
 SELECT 'pw-biz-'||NEW.id,NEW.operator_id,'business',NEW.id,'tsp-business-'||NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE NOT EXISTS(SELECT 1 FROM platform_workspaces WHERE operator_id=NEW.operator_id AND business_id=NEW.id AND scope_kind='business');
END;
INSERT INTO platform_workspaces(id,operator_id,scope_kind,source_workspace_id,created_at,updated_at)
 SELECT 'pw-op-'||id,id,'operator','tsp-operator-'||id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM operators;
INSERT INTO platform_workspaces(id,operator_id,scope_kind,business_id,source_workspace_id,created_at,updated_at)
 SELECT 'pw-biz-'||id,operator_id,'business',id,'tsp-business-'||id,created_at,created_at FROM businesses WHERE is_tenant=1;

CREATE TABLE platform_business_members(
 operator_id TEXT NOT NULL,
 business_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 granted_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(operator_id,business_id,user_id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,user_id) REFERENCES staff_users(operator_id,id),
 FOREIGN KEY(operator_id,granted_by) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX platform_business_member_access ON platform_business_members(operator_id,user_id,active,business_id);
