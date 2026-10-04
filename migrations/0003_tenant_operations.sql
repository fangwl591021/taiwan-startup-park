CREATE TABLE locations(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),name TEXT NOT NULL,address TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),created_at TEXT NOT NULL,UNIQUE(operator_id,id)
);
CREATE TABLE service_plans(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL REFERENCES operators(id),name TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN('website','store','line','crm')),
 amount INTEGER NOT NULL CHECK(amount>=0),duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 3660),
 quota_limit INTEGER NOT NULL CHECK(quota_limit>=0),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(operator_id,id)
);
CREATE TABLE address_contracts(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,location_id TEXT NOT NULL,
 starts_on TEXT NOT NULL,ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),amount INTEGER NOT NULL CHECK(amount>=0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','ended')),
 reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,
 renewal_of TEXT UNIQUE REFERENCES address_contracts(id),actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(operator_id,request_key),UNIQUE(operator_id,business_id,id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,location_id) REFERENCES locations(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE TRIGGER contract_overlap_insert BEFORE INSERT ON address_contracts WHEN NEW.status='active'
BEGIN SELECT RAISE(ABORT,'contract_overlap') WHERE EXISTS(SELECT 1 FROM address_contracts c WHERE c.operator_id=NEW.operator_id AND c.business_id=NEW.business_id AND c.location_id=NEW.location_id AND c.status='active' AND c.starts_on<=NEW.ends_on AND c.ends_on>=NEW.starts_on); END;
CREATE TRIGGER contract_overlap_update BEFORE UPDATE ON address_contracts WHEN NEW.status='active'
BEGIN SELECT RAISE(ABORT,'contract_overlap') WHERE EXISTS(SELECT 1 FROM address_contracts c WHERE c.operator_id=NEW.operator_id AND c.business_id=NEW.business_id AND c.location_id=NEW.location_id AND c.status='active' AND c.id<>NEW.id AND c.starts_on<=NEW.ends_on AND c.ends_on>=NEW.starts_on); END;
CREATE TABLE subscriptions(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,plan_id TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN('website','store','line','crm')),plan_name TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>=0),quota_limit INTEGER NOT NULL CHECK(quota_limit>=0),
 starts_on TEXT NOT NULL,ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','trial','active','paused','cancelled')),
 resume_status TEXT CHECK(resume_status IN('active','trial')),note TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,renewal_of TEXT UNIQUE REFERENCES subscriptions(id),actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(operator_id,request_key),UNIQUE(operator_id,business_id,id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,plan_id) REFERENCES service_plans(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE TRIGGER subscription_overlap_insert BEFORE INSERT ON subscriptions WHEN NEW.status IN('active','trial')
BEGIN SELECT RAISE(ABORT,'subscription_overlap') WHERE EXISTS(SELECT 1 FROM subscriptions s WHERE s.operator_id=NEW.operator_id AND s.business_id=NEW.business_id AND s.module=NEW.module AND s.status IN('active','trial') AND s.starts_on<=NEW.ends_on AND s.ends_on>=NEW.starts_on); END;
CREATE TRIGGER subscription_overlap_update BEFORE UPDATE ON subscriptions WHEN NEW.status IN('active','trial')
BEGIN SELECT RAISE(ABORT,'subscription_overlap') WHERE EXISTS(SELECT 1 FROM subscriptions s WHERE s.operator_id=NEW.operator_id AND s.business_id=NEW.business_id AND s.module=NEW.module AND s.status IN('active','trial') AND s.id<>NEW.id AND s.starts_on<=NEW.ends_on AND s.ends_on>=NEW.starts_on); END;
CREATE TABLE receivables(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('address','digital')),contract_id TEXT,subscription_id TEXT,
 amount INTEGER NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'TWD' CHECK(currency='TWD'),
 due_on TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','void')),
 note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((kind='address' AND contract_id IS NOT NULL AND subscription_id IS NULL) OR (kind='digital' AND subscription_id IS NOT NULL AND contract_id IS NULL)),
 UNIQUE(contract_id),UNIQUE(subscription_id),UNIQUE(operator_id,request_key),UNIQUE(operator_id,business_id,id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,business_id,contract_id) REFERENCES address_contracts(operator_id,business_id,id),
 FOREIGN KEY(operator_id,business_id,subscription_id) REFERENCES subscriptions(operator_id,business_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE TABLE ledger_entries(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,receivable_id TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN('receipt','refund')),amount INTEGER NOT NULL CHECK(amount>0),
 refund_of TEXT REFERENCES ledger_entries(id),reference TEXT NOT NULL,actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,
 CHECK((direction='receipt' AND refund_of IS NULL) OR (direction='refund' AND refund_of IS NOT NULL)),
 UNIQUE(operator_id,request_key),
 FOREIGN KEY(operator_id,business_id,receivable_id) REFERENCES receivables(operator_id,business_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE TRIGGER ledger_valid BEFORE INSERT ON ledger_entries
BEGIN
 SELECT RAISE(ABORT,'receivable_closed') WHERE NOT EXISTS(SELECT 1 FROM receivables WHERE id=NEW.receivable_id AND operator_id=NEW.operator_id AND status='open');
 SELECT RAISE(ABORT,'overpayment') WHERE NEW.direction='receipt' AND NEW.amount+COALESCE((SELECT SUM(CASE WHEN direction='receipt' THEN amount ELSE -amount END) FROM ledger_entries WHERE receivable_id=NEW.receivable_id),0)>(SELECT amount FROM receivables WHERE id=NEW.receivable_id);
 SELECT RAISE(ABORT,'invalid_refund') WHERE NEW.direction='refund' AND NOT EXISTS(SELECT 1 FROM ledger_entries r WHERE r.id=NEW.refund_of AND r.operator_id=NEW.operator_id AND r.receivable_id=NEW.receivable_id AND r.direction='receipt' AND r.amount>=NEW.amount+COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE refund_of=r.id),0));
END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'ledger_append_only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'ledger_append_only'); END;
CREATE TABLE mail_items(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('letter','package')),
 description TEXT NOT NULL,carrier TEXT NOT NULL DEFAULT '',tracking_no TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','ready','collected','forwarded','returned')),
 handoff_reference TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(operator_id,request_key),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE TABLE maintenance_tickets(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,
 priority TEXT NOT NULL CHECK(priority IN('low','normal','high')),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','in_progress','resolved','closed')),
 resolution TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(operator_id,request_key),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX contracts_scope ON address_contracts(operator_id,business_id,status,ends_on);
CREATE INDEX subscriptions_scope ON subscriptions(operator_id,business_id,module,status,ends_on);
CREATE INDEX receivables_scope ON receivables(operator_id,business_id,kind,status);
CREATE INDEX ledger_receivable ON ledger_entries(operator_id,receivable_id);
CREATE INDEX mail_scope ON mail_items(operator_id,business_id,status);
CREATE INDEX tickets_scope ON maintenance_tickets(operator_id,business_id,status);

CREATE TRIGGER receivable_void_balance BEFORE UPDATE OF status ON receivables WHEN NEW.status='void'
BEGIN SELECT RAISE(ABORT,'receivable_balance') WHERE COALESCE((SELECT SUM(CASE WHEN direction='receipt' THEN amount ELSE -amount END) FROM ledger_entries WHERE receivable_id=NEW.id),0)<>0; END;
CREATE TRIGGER subscription_paid_gate BEFORE UPDATE OF status ON subscriptions WHEN NEW.status='active' AND NEW.amount>0
BEGIN SELECT RAISE(ABORT,'subscription_unpaid') WHERE NOT EXISTS(SELECT 1 FROM receivables r WHERE r.subscription_id=NEW.id AND r.operator_id=NEW.operator_id AND r.business_id=NEW.business_id AND r.status='open' AND r.amount=NEW.amount AND COALESCE((SELECT SUM(CASE WHEN direction='receipt' THEN amount ELSE -amount END) FROM ledger_entries WHERE receivable_id=r.id),0)>=r.amount); END;
