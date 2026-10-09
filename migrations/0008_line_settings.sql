ALTER TABLE line_connections ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE line_connections ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE line_connections ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE line_connections ADD COLUMN verified_at TEXT;
ALTER TABLE line_connections ADD COLUMN last_webhook_at TEXT;
CREATE TABLE line_connection_secrets(
 connection_id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,
 encrypted_value TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id)
);
