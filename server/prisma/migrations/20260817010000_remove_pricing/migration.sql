DROP TABLE IF EXISTS "model_prices";
DROP TYPE IF EXISTS "PricingType";

ALTER TABLE "users" DROP COLUMN IF EXISTS "monthly_budget_usd";
ALTER TABLE "ai_usage_records"
    DROP COLUMN IF EXISTS "price_snapshot",
    DROP COLUMN IF EXISTS "amount_usd",
    DROP COLUMN IF EXISTS "calculation_detail";

UPDATE "generation_jobs" SET "params" = "params" - '_priceRuleId' WHERE "params" ? '_priceRuleId';
DELETE FROM "admin_audit_logs" WHERE "action" LIKE 'model_price.%';
