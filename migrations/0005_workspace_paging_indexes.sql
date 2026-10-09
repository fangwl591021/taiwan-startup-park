-- Additive indexes only; preserve all records and access scopes.
CREATE INDEX IF NOT EXISTS businesses_tenant_page ON businesses(operator_id,is_tenant,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS businesses_service_page ON businesses(operator_id,service_owner_id,is_tenant,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS opportunities_updated_page ON opportunities(operator_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS opportunities_owner_page ON opportunities(operator_id,owner_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS opportunities_business_owner ON opportunities(operator_id,business_id,owner_id);
CREATE INDEX IF NOT EXISTS conversations_created_page ON conversations(operator_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS service_requests_business_status ON service_requests(operator_id,business_id,status);
