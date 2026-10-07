ALTER TABLE platform_line_account ADD COLUMN destination TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_line_account ADD COLUMN last_webhook_at TEXT NOT NULL DEFAULT '';
CREATE TABLE platform_line_events (
 account_id INTEGER NOT NULL DEFAULT 1 REFERENCES platform_line_account(id),
 channel_id TEXT NOT NULL,event_id TEXT NOT NULL,
 kind TEXT NOT NULL,source_type TEXT NOT NULL,user_id TEXT NOT NULL DEFAULT '',
 provider_message_id TEXT,body TEXT,event_at INTEGER NOT NULL,received_at TEXT NOT NULL,
 PRIMARY KEY(channel_id,event_id)
);
CREATE INDEX platform_line_events_time ON platform_line_events(channel_id,event_at DESC,event_id DESC);
CREATE TABLE platform_line_unsends (
 channel_id TEXT NOT NULL,provider_message_id TEXT NOT NULL,
 PRIMARY KEY(channel_id,provider_message_id)
);
