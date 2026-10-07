-- Platform-owned account configuration. Login and Messaging secrets stay distinct.
CREATE TABLE platform_line_account (
 id INTEGER PRIMARY KEY CHECK(id=1),
 oa_name TEXT NOT NULL DEFAULT '',basic_id TEXT NOT NULL DEFAULT '',
 messaging_channel_id TEXT NOT NULL DEFAULT '',messaging_provider_id TEXT NOT NULL DEFAULT '',
 encrypted_messaging TEXT NOT NULL DEFAULT '',
 webhook_key TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT '',
 updated_by TEXT REFERENCES staff_users(id)
);
INSERT INTO platform_line_account(id,oa_name,messaging_channel_id,messaging_provider_id,webhook_key)
 SELECT 1,oa_name,channel_id,provider_id,'platform-'||lower(hex(randomblob(24))) FROM platform_settings WHERE id=1;
