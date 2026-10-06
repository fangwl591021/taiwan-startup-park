-- Recipient identity stays scoped to the operator's observed LINE channel.
CREATE TABLE tenant_mail_line_recipients(
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,business_id TEXT NOT NULL,
 line_contact_id TEXT,recipient_name TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('linked','unlinked')),
 actor_id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(operator_id,business_id),
 CHECK((status='linked' AND line_contact_id IS NOT NULL AND length(recipient_name)>0) OR (status='unlinked' AND line_contact_id IS NULL)),
 FOREIGN KEY(operator_id,business_id) REFERENCES businesses(operator_id,id),
 FOREIGN KEY(operator_id,line_contact_id) REFERENCES line_contacts(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES staff_users(operator_id,id)
);
CREATE INDEX line_events_contact_observed ON line_events(operator_id,connection_id,user_id,kind,event_at DESC);
