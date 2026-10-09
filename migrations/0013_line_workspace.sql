-- Adapt Smart-Menu-Studio's workspace/CRM/template mechanisms to operator scope.
-- No customer data, private risk keywords, prices or revenue rates are seeded.
CREATE TABLE workspace_modules (
 operator_id TEXT NOT NULL REFERENCES operators(id), module TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, updated_by TEXT REFERENCES staff_users(id),
 PRIMARY KEY(operator_id,module)
);
INSERT INTO workspace_modules(operator_id,module,enabled,updated_at)
 SELECT id,'crm',1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM operators;
INSERT INTO workspace_modules(operator_id,module,enabled,updated_at)
 SELECT id,'templates',1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM operators;
INSERT INTO workspace_modules(operator_id,module,enabled,updated_at)
 SELECT id,'line_hub',1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM operators;
INSERT INTO workspace_modules(operator_id,module,enabled,updated_at)
 SELECT id,'monitor',1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM operators;
CREATE TRIGGER operator_workspace_modules AFTER INSERT ON operators BEGIN
 INSERT INTO workspace_modules(operator_id,module,enabled,updated_at) VALUES
 (NEW.id,'crm',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (NEW.id,'templates',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (NEW.id,'line_hub',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (NEW.id,'monitor',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TABLE crm_people (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id),
 contact_id TEXT, business_id TEXT, assigned_id TEXT,
 name TEXT NOT NULL, company_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
 source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(operator_id,id), UNIQUE(operator_id,contact_id),
 FOREIGN KEY(operator_id,contact_id) REFERENCES contacts(operator_id,id),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,assigned_id) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX crm_people_page ON crm_people(operator_id,status,updated_at DESC,id DESC);
INSERT INTO crm_people(id,operator_id,contact_id,business_id,name,company_name,phone,email,source,created_at,updated_at)
 SELECT 'crm-contact-'||c.id,c.operator_id,c.id,c.business_id,c.name,b.name,c.phone,c.email,'existing_contact',b.created_at,b.created_at
 FROM contacts c JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id;
CREATE TRIGGER contact_crm_created AFTER INSERT ON contacts BEGIN
 INSERT INTO crm_people(id,operator_id,contact_id,business_id,name,company_name,phone,email,source,created_at,updated_at)
 SELECT 'crm-contact-'||NEW.id,NEW.operator_id,NEW.id,NEW.business_id,NEW.name,b.name,NEW.phone,NEW.email,'case_contact',b.created_at,b.created_at
 FROM businesses b WHERE b.id=NEW.business_id AND b.operator_id=NEW.operator_id;
END;
CREATE TABLE crm_line_links (
 operator_id TEXT NOT NULL, person_id TEXT NOT NULL, line_contact_id TEXT NOT NULL,
 linked_at TEXT NOT NULL, PRIMARY KEY(operator_id,line_contact_id),
 FOREIGN KEY(operator_id,person_id) REFERENCES crm_people(operator_id,id),
 FOREIGN KEY(operator_id,line_contact_id) REFERENCES line_contacts(operator_id,id)
);
CREATE TRIGGER line_contact_crm_created AFTER INSERT ON line_contacts BEGIN
 INSERT INTO crm_people(id,operator_id,name,source,created_at,updated_at)
 VALUES('crm-line-'||NEW.id,NEW.operator_id,'LINE 來客','line_webhook',NEW.created_at,NEW.created_at);
 INSERT INTO crm_line_links VALUES(NEW.operator_id,'crm-line-'||NEW.id,NEW.id,NEW.created_at);
END;
INSERT INTO crm_people(id,operator_id,business_id,name,company_name,source,created_at,updated_at)
 SELECT 'crm-line-'||l.id,l.operator_id,c.business_id,'LINE 來客',COALESCE(b.name,''),'line_webhook',l.created_at,l.created_at
 FROM line_contacts l LEFT JOIN conversations c ON c.operator_id=l.operator_id AND c.id=l.conversation_id
 LEFT JOIN businesses b ON b.operator_id=c.operator_id AND b.id=c.business_id;
INSERT INTO crm_line_links SELECT operator_id,'crm-line-'||id,id,created_at FROM line_contacts;
CREATE TRIGGER line_contact_crm_assigned AFTER UPDATE OF conversation_id ON line_contacts
 WHEN NEW.conversation_id IS NOT NULL BEGIN
 UPDATE crm_people SET business_id=(SELECT business_id FROM conversations WHERE operator_id=NEW.operator_id AND id=NEW.conversation_id),
 company_name=(SELECT b.name FROM conversations c JOIN businesses b ON b.id=c.business_id AND b.operator_id=c.operator_id WHERE c.operator_id=NEW.operator_id AND c.id=NEW.conversation_id),
 version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE operator_id=NEW.operator_id AND id IN(SELECT person_id FROM crm_line_links WHERE operator_id=NEW.operator_id AND line_contact_id=NEW.id);
END;
CREATE TABLE crm_case_requests (
 operator_id TEXT NOT NULL, person_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 opportunity_id TEXT NOT NULL, business_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(operator_id,person_id,request_key),
 FOREIGN KEY(operator_id,person_id) REFERENCES crm_people(operator_id,id)
);
CREATE TABLE workspace_templates (
 id TEXT PRIMARY KEY, operator_id TEXT REFERENCES operators(id), name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('message','rich_menu')), content TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('draft','ready')), version INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL REFERENCES staff_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX workspace_templates_list ON workspace_templates(operator_id,status,updated_at DESC);
CREATE TABLE line_keyword_routes (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id), keyword TEXT NOT NULL,
 match_type TEXT NOT NULL CHECK(match_type IN('exact','contains')),
 destination TEXT NOT NULL CHECK(destination IN('address','renewal','mail','billing','support')),
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, UNIQUE(operator_id,keyword)
);
CREATE TABLE operator_line_login (
 connection_id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '',
 provider_id TEXT NOT NULL DEFAULT '', encrypted_secret TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,connection_id) REFERENCES line_connections(operator_id,id)
);
CREATE TABLE risk_rules (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id), name TEXT NOT NULL,
 keywords TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, UNIQUE(operator_id,id)
);
CREATE TABLE risk_events (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, rule_id TEXT NOT NULL, message_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','reviewing','normal','false_positive','confirmed')),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,rule_id) REFERENCES risk_rules(operator_id,id),
 FOREIGN KEY(message_id) REFERENCES messages(id), UNIQUE(operator_id,rule_id,message_id)
);
CREATE TABLE risk_reviews (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id), event_id TEXT REFERENCES risk_events(id),
 actor_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX risk_events_page ON risk_events(operator_id,created_at DESC);
