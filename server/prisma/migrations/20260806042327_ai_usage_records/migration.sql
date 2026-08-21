-- CreateEnum
CREATE TYPE "UsageSource" AS ENUM ('provider', 'estimated', 'none');

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "model_id" TEXT NOT NULL,
    "capability" "ModelCapability" NOT NULL,
    "status" "JobStatus" NOT NULL,
    "price_snapshot" JSONB,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "media_units" JSONB,
    "usage_source" "UsageSource" NOT NULL,
    "usage_estimation_method" TEXT,
    "tokenizer_name" TEXT,
    "tokenizer_version" TEXT,
    "amount_usd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "calculation_detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_records_job_id_key" ON "ai_usage_records"("job_id");

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_created_at_idx" ON "ai_usage_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_project_id_created_at_idx" ON "ai_usage_records"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_model_id_created_at_idx" ON "ai_usage_records"("model_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_capability_created_at_idx" ON "ai_usage_records"("capability", "created_at");

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
