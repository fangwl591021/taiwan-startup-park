PRAGMA foreign_keys = ON;
CREATE TABLE operators (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE staff_users (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id), name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('operator_owner','operator_sales','operator_service','operator_finance','platform_admin','business_admin')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), UNIQUE(operator_id,id)
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES staff_users(id), expires_at TEXT NOT NULL);
CREATE TABLE businesses (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id), name TEXT NOT NULL,
 registration_no TEXT, is_tenant INTEGER NOT NULL DEFAULT 0 CHECK(is_tenant IN(0,1)), service_owner_id TEXT,
 created_at TEXT NOT NULL, UNIQUE(operator_id,id), UNIQUE(operator_id,registration_no),
 FOREIGN KEY(operator_id,service_owner_id) REFERENCES staff_users(operator_id,id)
);
CREATE TABLE contacts (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, business_id TEXT NOT NULL,
 name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id), UNIQUE(operator_id,id)
);
CREATE TABLE opportunities (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, business_id TEXT NOT NULL, title TEXT NOT NULL,
 stage TEXT NOT NULL DEFAULT 'contact' CHECK(stage IN('contact','onboarding','billing','won','paused','lost')),
 owner_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '人工建立',
 amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0), payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','paid')),
 next_action TEXT NOT NULL DEFAULT '', followup_at TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,owner_id) REFERENCES staff_users(operator_id,id), UNIQUE(operator_id,id)
);
CREATE TABLE conversations (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, business_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 first_agent_id TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,opportunity_id) REFERENCES opportunities(operator_id,id),
 FOREIGN KEY(operator_id,first_agent_id) REFERENCES staff_users(operator_id,id),
 UNIQUE(operator_id,id), UNIQUE(operator_id,opportunity_id)
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, conversation_id TEXT NOT NULL, actor_id TEXT,
 direction TEXT NOT NULL CHECK(direction IN('in','out')), body TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('customer','human','ai_auto','ai_approved')),
 approved_by TEXT, status TEXT NOT NULL CHECK(status IN('received_demo','simulated','failed')),
 idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,conversation_id) REFERENCES conversations(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id),
 FOREIGN KEY(operator_id,approved_by) REFERENCES staff_users(operator_id,id),
 UNIQUE(operator_id,conversation_id,idempotency_key)
);
CREATE TABLE service_requests (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, business_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN('website','store','line','crm')),
 status TEXT NOT NULL CHECK(status IN('requested','cancelled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE UNIQUE INDEX service_request_open ON service_requests(operator_id,business_id,module) WHERE status='requested';
CREATE TABLE activity_events (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, business_id TEXT, opportunity_id TEXT,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,opportunity_id) REFERENCES opportunities(operator_id,id)
);
CREATE INDEX opportunities_scope ON opportunities(operator_id,owner_id,stage);
CREATE INDEX contacts_scope ON contacts(operator_id,business_id);
CREATE INDEX messages_scope ON messages(operator_id,conversation_id,created_at);
CREATE INDEX activity_scope ON activity_events(operator_id,business_id,created_at);
