-- LINE Login credentials must never inherit a Messaging API channel.
CREATE TABLE platform_line_login (
 id INTEGER PRIMARY KEY CHECK(id=1),
 provider_id TEXT NOT NULL DEFAULT '',channel_id TEXT NOT NULL DEFAULT '',
 encrypted_secret TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT '',updated_by TEXT REFERENCES staff_users(id)
);
INSERT INTO platform_line_login(id) VALUES(1);
