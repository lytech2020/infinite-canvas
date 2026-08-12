-- AlterTable
ALTER TABLE "users" ADD COLUMN     "concurrency_limit" INTEGER,
ADD COLUMN     "daily_call_limit" INTEGER,
ADD COLUMN     "monthly_budget_usd" DECIMAL(18,8),
ADD COLUMN     "video_concurrency_limit" INTEGER;
