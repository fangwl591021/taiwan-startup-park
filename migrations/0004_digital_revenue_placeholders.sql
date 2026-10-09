-- Phase one: retain future commercial terms with NULL meaning "not agreed", never zero.
-- No collection, payout or settlement table/process is created by this migration.
CREATE TABLE digital_revenue_terms (
 operator_id TEXT NOT NULL REFERENCES operators(id),
 module TEXT NOT NULL CHECK(module IN('website','store','line','crm')),
 status TEXT NOT NULL DEFAULT 'unagreed' CHECK(status IN('unagreed','agreed','retired')),
 partner_name TEXT,
 settlement_basis TEXT CHECK(settlement_basis IS NULL OR settlement_basis='net_collected'),
 platform_fee_amount INTEGER CHECK(platform_fee_amount IS NULL OR platform_fee_amount>=0),
 platform_share_bps INTEGER CHECK(platform_share_bps IS NULL OR platform_share_bps BETWEEN 0 AND 10000),
 operator_share_bps INTEGER CHECK(operator_share_bps IS NULL OR operator_share_bps BETWEEN 0 AND 10000),
 settlement_cycle TEXT CHECK(settlement_cycle IS NULL OR settlement_cycle IN('monthly','quarterly','yearly')),
 effective_on TEXT,
 agreement_reference TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(operator_id,module),
 CHECK((platform_share_bps IS NULL AND operator_share_bps IS NULL)
   OR (platform_share_bps IS NOT NULL AND operator_share_bps IS NOT NULL AND platform_share_bps+operator_share_bps=10000)),
 CHECK(status!='unagreed' OR (partner_name IS NULL AND settlement_basis IS NULL
   AND platform_fee_amount IS NULL AND platform_share_bps IS NULL AND operator_share_bps IS NULL
   AND settlement_cycle IS NULL AND effective_on IS NULL AND agreement_reference IS NULL)),
 CHECK(status!='agreed' OR (partner_name IS NOT NULL AND length(trim(partner_name))>0
   AND settlement_basis IS NOT NULL AND platform_share_bps IS NOT NULL AND operator_share_bps IS NOT NULL
   AND settlement_cycle IS NOT NULL AND effective_on IS NOT NULL
   AND agreement_reference IS NOT NULL AND length(trim(agreement_reference))>0))
);
INSERT INTO digital_revenue_terms(operator_id,module)
 SELECT o.id,m.module FROM operators o
 CROSS JOIN (SELECT 'website' AS module UNION ALL SELECT 'store' UNION ALL SELECT 'line' UNION ALL SELECT 'crm') m;
CREATE TRIGGER digital_terms_new_operator AFTER INSERT ON operators
BEGIN
 INSERT INTO digital_revenue_terms(operator_id,module) VALUES(NEW.id,'website'),(NEW.id,'store'),(NEW.id,'line'),(NEW.id,'crm');
END;
