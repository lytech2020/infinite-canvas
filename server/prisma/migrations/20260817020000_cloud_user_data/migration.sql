ALTER TABLE "projects" ADD COLUMN "data" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "projects" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "uploads" ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "uploads" ADD COLUMN "delete_pending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "uploads" ADD COLUMN "delete_locked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "user_data" (
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_data_pkey" PRIMARY KEY ("user_id", "key")
);

ALTER TABLE "user_data" ADD CONSTRAINT "user_data_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "upload_references" (
    "upload_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    CONSTRAINT "upload_references_pkey" PRIMARY KEY ("user_id", "upload_id", "source_type", "source_key")
);

CREATE UNIQUE INDEX "uploads_user_id_id_key" ON "uploads"("user_id", "id");
CREATE INDEX "upload_references_user_id_source_type_source_key_idx" ON "upload_references"("user_id", "source_type", "source_key");

ALTER TABLE "upload_references" ADD CONSTRAINT "upload_references_user_id_upload_id_fkey"
    FOREIGN KEY ("user_id", "upload_id") REFERENCES "uploads"("user_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
