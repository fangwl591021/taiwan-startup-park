ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'demo' CHECK(auth_method IN('demo','access'));
ALTER TABLE sessions ADD COLUMN issuer TEXT;
ALTER TABLE sessions ADD COLUMN subject TEXT;
CREATE TABLE auth_identities (
 issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES staff_users(id),
 PRIMARY KEY(issuer,subject), UNIQUE(issuer,user_id)
);
CREATE TABLE line_connections (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id), provider_id TEXT NOT NULL,
 channel_id TEXT NOT NULL UNIQUE, destination TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)), UNIQUE(operator_id,id)
);
CREATE TABLE line_contacts (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, connection_id TEXT NOT NULL, user_id TEXT NOT NULL,
 conversation_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(connection_id,user_id), UNIQUE(conversation_id), UNIQUE(operator_id,id),
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id),
 FOREIGN KEY(operator_id,conversation_id) REFERENCES conversations(operator_id,id)
);
CREATE TABLE line_events (
 connection_id TEXT NOT NULL, event_id TEXT NOT NULL, operator_id TEXT NOT NULL,
 kind TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '', provider_message_id TEXT,
 body TEXT, event_at INTEGER NOT NULL, received_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processed','unmatched','unsupported')),
 PRIMARY KEY(connection_id,event_id),
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id)
);
CREATE TABLE line_unsends (
 connection_id TEXT NOT NULL REFERENCES line_connections(id), provider_message_id TEXT NOT NULL,
 PRIMARY KEY(connection_id,provider_message_id)
);
CREATE TABLE messages_v2 (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, conversation_id TEXT NOT NULL, actor_id TEXT,
 direction TEXT NOT NULL CHECK(direction IN('in','out')), body TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('customer','human','ai_auto','ai_approved')),
 approved_by TEXT, status TEXT NOT NULL CHECK(status IN('received_demo','simulated','failed','received','removed','queued','sending','accepted','unknown','blocked')),
 idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 connection_id TEXT, provider_message_id TEXT,
 FOREIGN KEY(operator_id,conversation_id) REFERENCES conversations(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id),
 FOREIGN KEY(operator_id,approved_by) REFERENCES staff_users(operator_id,id),
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id),
 UNIQUE(operator_id,conversation_id,idempotency_key)
);
INSERT INTO messages_v2(id,operator_id,conversation_id,actor_id,direction,body,source,approved_by,status,idempotency_key,created_at,updated_at)
 SELECT id,operator_id,conversation_id,actor_id,direction,body,source,approved_by,status,idempotency_key,created_at,updated_at FROM messages;
DROP TABLE messages;
ALTER TABLE messages_v2 RENAME TO messages;
CREATE INDEX messages_scope ON messages(operator_id,conversation_id,created_at);
CREATE UNIQUE INDEX line_message_unique ON messages(connection_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE line_outbox (
 id TEXT PRIMARY KEY REFERENCES messages(id), operator_id TEXT NOT NULL, connection_id TEXT NOT NULL,
 recipient TEXT NOT NULL, retry_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'queued'
 CHECK(state IN('queued','sending','retry','unknown','accepted','failed','blocked','needs_review')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
 first_attempt_at INTEGER, lease_token TEXT, lease_until INTEGER,
 provider_request_id TEXT, last_error TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id)
);
CREATE INDEX outbox_due ON line_outbox(state,next_attempt_at,lease_until);
CREATE INDEX events_pending ON line_events(state,event_at);
