-- Preserve all existing terms as unknown until an authorized operator confirms them.
ALTER TABLE address_contracts ADD COLUMN term_kind TEXT CHECK(term_kind IS NULL OR term_kind IN('monthly','annual','two_year','custom'));
ALTER TABLE address_contracts ADD COLUMN payment_cycle TEXT CHECK(payment_cycle IS NULL OR payment_cycle IN('once','monthly','quarterly','half_yearly','yearly','custom'));
ALTER TABLE address_contracts ADD COLUMN mail_service TEXT CHECK(mail_service IS NULL OR mail_service IN('included','excluded','by_agreement'));
CREATE INDEX address_contracts_service_lookup ON address_contracts(operator_id,business_id,status,ends_on DESC,id DESC);
