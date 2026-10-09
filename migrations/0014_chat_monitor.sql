-- Additive monitor storage. No production rules, model calls or prices are seeded.
CREATE TABLE monitor_groups (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, connection_id TEXT NOT NULL,
 source_type TEXT NOT NULL CHECK(source_type IN('group','room')), source_id TEXT NOT NULL,
 name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 departed INTEGER NOT NULL DEFAULT 0 CHECK(departed IN(0,1)), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, last_event_at TEXT NOT NULL, UNIQUE(operator_id,id), UNIQUE(connection_id,source_type,source_id),
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id)
);
CREATE INDEX monitor_groups_scope ON monitor_groups(operator_id,last_event_at DESC,id DESC);
CREATE TABLE monitor_group_messages (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, group_id TEXT NOT NULL, connection_id TEXT NOT NULL,
 event_id TEXT NOT NULL, provider_message_id TEXT NOT NULL, member_hash TEXT,
 body TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)), created_at TEXT NOT NULL,
 UNIQUE(operator_id,id), UNIQUE(connection_id,event_id), UNIQUE(connection_id,provider_message_id),
 FOREIGN KEY(operator_id,group_id) REFERENCES monitor_groups(operator_id,id),
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id)
);
CREATE INDEX monitor_group_messages_scope ON monitor_group_messages(operator_id,created_at DESC,id DESC);
CREATE INDEX monitor_group_messages_group ON monitor_group_messages(operator_id,group_id,created_at DESC,id DESC);
CREATE TABLE monitor_group_rules (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, name TEXT NOT NULL, keywords TEXT NOT NULL,
 context_words TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, UNIQUE(operator_id,id),
 FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE monitor_group_opportunities (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, rule_id TEXT NOT NULL, message_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','reviewing','accepted','discarded')),
 person_id TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 UNIQUE(operator_id,id), UNIQUE(rule_id,message_id),
 FOREIGN KEY(operator_id,rule_id) REFERENCES monitor_group_rules(operator_id,id),
 FOREIGN KEY(operator_id,message_id) REFERENCES monitor_group_messages(operator_id,id),
 FOREIGN KEY(operator_id,person_id) REFERENCES crm_people(operator_id,id)
);
CREATE INDEX monitor_group_opportunities_scope ON monitor_group_opportunities(operator_id,created_at DESC,id DESC);
CREATE TABLE monitor_group_reviews (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 target_id TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX monitor_group_reviews_scope ON monitor_group_reviews(operator_id,created_at DESC,id DESC);
CREATE TABLE ai_call_ledger (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 feature TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('success','failed','cached','fallback')),
 input_tokens INTEGER CHECK(input_tokens>=0), output_tokens INTEGER CHECK(output_tokens>=0),
 total_tokens INTEGER CHECK(total_tokens>=0), cached_input_tokens INTEGER CHECK(cached_input_tokens>=0),
 provider_cost_micros INTEGER CHECK(provider_cost_micros>=0), billable_cost_micros INTEGER CHECK(billable_cost_micros>=0),
 currency TEXT CHECK(currency='USD'), pricing_version TEXT,
 latency_ms INTEGER NOT NULL CHECK(latency_ms>=0), error_code TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX ai_call_scope ON ai_call_ledger(operator_id,created_at DESC,id DESC);
CREATE INDEX ai_call_feature ON ai_call_ledger(operator_id,feature,created_at);
