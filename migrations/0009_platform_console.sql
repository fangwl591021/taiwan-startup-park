-- Platform access is separate from operator ownership. Only the preapproved
-- first account created by owner-setup receives the deployment bootstrap grant.
CREATE TABLE platform_admin_grants (
 user_id TEXT PRIMARY KEY REFERENCES staff_users(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 reference TEXT NOT NULL,
 created_at TEXT NOT NULL
);
INSERT INTO platform_admin_grants(user_id,reference,created_at)
 SELECT u.id,'已授權首位平台建立者：系統後台初始化',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM staff_users u WHERE u.id='tsp-primary-owner'
 AND u.operator_id='tsp-primary-operator' AND u.role='operator_owner' AND u.active=1
 AND EXISTS(SELECT 1 FROM auth_identities i WHERE i.user_id=u.id);
UPDATE staff_users SET name='平台建立者' WHERE id='tsp-primary-owner' AND name='總管理員'
 AND EXISTS(SELECT 1 FROM platform_admin_grants g WHERE g.user_id=staff_users.id);
UPDATE staff_users SET name='系統總管理員（虛構）' WHERE id='platform'
 AND role='platform_admin' AND name='平台管理（未開放）';
CREATE TABLE platform_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 oa_name TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL DEFAULT '',
 channel_id TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '',
 onboarding_template TEXT NOT NULL DEFAULT '', service_template TEXT NOT NULL DEFAULT '',
 monthly_limit INTEGER CHECK(monthly_limit IS NULL OR monthly_limit BETWEEN 0 AND 1000000),
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT REFERENCES staff_users(id)
);
INSERT INTO platform_settings(id) VALUES(1);
CREATE TABLE platform_activity (
 id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES staff_users(id),
 action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX platform_activity_time ON platform_activity(created_at DESC,id DESC);
