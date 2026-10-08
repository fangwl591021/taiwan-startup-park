// Keep the imported snapshot immutable. Only normalize this verified trigger in execution copies.
// Wrangler terminates a trigger at the nested CASE END; D1 supports the equivalent WHEN guard.
const original="CREATE TRIGGER IF NOT EXISTS point_redemptions_prevent_overspend\nBEFORE INSERT ON point_redemptions\nBEGIN\n  SELECT CASE\n    WHEN (\n      COALESCE((\n        SELECT SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE -points END)\n        FROM member_point_ledger_entries\n        WHERE workspace_id = NEW.workspace_id\n          AND line_account_id = NEW.line_account_id\n          AND point_account_id = NEW.point_account_id\n      ),0)\n    ) < NEW.points_cost_snapshot\n    THEN RAISE(ABORT, 'INSUFFICIENT_POINTS')\n  END;\nEND;";
const replacement="CREATE TRIGGER IF NOT EXISTS point_redemptions_prevent_overspend\nBEFORE INSERT ON point_redemptions\nWHEN (\n  COALESCE((\n    SELECT SUM(CASE WHEN entry_type = 'CREDIT' THEN points ELSE -points END)\n    FROM member_point_ledger_entries\n    WHERE workspace_id = NEW.workspace_id\n      AND line_account_id = NEW.line_account_id\n      AND point_account_id = NEW.point_account_id\n  ),0)\n) < NEW.points_cost_snapshot\nBEGIN\n  SELECT RAISE(ABORT, 'INSUFFICIENT_POINTS');\nEND;";
export function platformMigrationSQL(name,sql){
 if(name!=='0033_reward_redemption_foundation.sql')return sql;
 if(sql.split(original).length!==2)throw new Error('Source point redemption trigger changed; refusing migration overlay');
 return sql.replace(original,replacement);
}
