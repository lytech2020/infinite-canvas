-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('canvas', 'image_workbench', 'video_workbench', 'other');

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "project_id" TEXT,
    "project_name_snapshot" TEXT,
    "node_id" TEXT,
    "source" "JobSource" NOT NULL,
    "model_id" TEXT NOT NULL,
    "capability" "ModelCapability" NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "error_detail" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_jobs_user_id_status_idx" ON "generation_jobs"("user_id", "status");

-- CreateIndex
CREATE INDEX "generation_jobs_user_id_created_at_idx" ON "generation_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_jobs_project_id_created_at_idx" ON "generation_jobs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_jobs_model_id_created_at_idx" ON "generation_jobs"("model_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "generation_jobs_user_id_request_id_key" ON "generation_jobs"("user_id", "request_id");

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
