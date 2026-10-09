-- Internal tools never open or bill customer digital services.
UPDATE platform_workspace_entitlements SET enabled=1,version=version+1 WHERE workspace_id IN (SELECT id FROM platform_workspaces WHERE scope_kind='operator');
DROP TRIGGER platform_workspace_grants;
CREATE TRIGGER platform_workspace_grants AFTER INSERT ON platform_workspaces BEGIN
 INSERT INTO platform_workspace_entitlements(operator_id,workspace_id,module,enabled,updated_at) VALUES
 (NEW.operator_id,NEW.id,'CORE_MENU',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'CRM',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'CAMPAIGN',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'COMMERCE',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'TRAVEL',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'DEALER_COMMISSION',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'POINTS_REWARDS',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at),
 (NEW.operator_id,NEW.id,'AI',CASE WHEN NEW.scope_kind='operator' THEN 1 ELSE 0 END,NEW.created_at);
END;

CREATE TABLE platform_runtime_revision(id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO platform_runtime_revision VALUES(1);
