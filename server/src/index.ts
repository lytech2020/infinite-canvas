import cookieParser from "cookie-parser";
import express from "express";

import { env } from "./env.js";
import { attachUser, requireAdmin, requireUser } from "./http/auth-middleware.js";
import { errorHandler } from "./http/response.js";
import { adminModelsRouter } from "./http/routes/admin/models.js";
import { adminOverviewRouter } from "./http/routes/admin/overview.js";
import { adminPromptsRouter } from "./http/routes/admin/prompts.js";
import { adminProvidersRouter } from "./http/routes/admin/providers.js";
import { adminSettingsRouter } from "./http/routes/admin/settings.js";
import { adminUsageRouter } from "./http/routes/admin/usage.js";
import { adminUsersRouter } from "./http/routes/admin/users.js";
import { authRouter } from "./http/routes/auth.js";
import { generationsRouter } from "./http/routes/generations.js";
import { modelsRouter } from "./http/routes/models.js";
import { projectsRouter } from "./http/routes/projects.js";
import { uploadsRouter } from "./http/routes/uploads.js";
import { logger } from "./logger.js";
import { releaseStaleJobs } from "./modules/generation/service.js";
import { cleanupExpiredUploads } from "./modules/storage/uploads.js";

const app = express();
if (env.isProduction) app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(attachUser);

app.get("/api/v1/health", (_req, res) => {
    res.json({ data: { ok: true } });
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/models", requireUser, modelsRouter);
app.use("/api/v1/projects", requireUser, projectsRouter);
app.use("/api/v1/generations", requireUser, generationsRouter);
app.use("/api/v1/uploads", requireUser, uploadsRouter);

const admin = [requireUser, requireAdmin];
app.use("/api/v1/admin/overview", admin, adminOverviewRouter);
app.use("/api/v1/admin/usage", admin, adminUsageRouter);
app.use("/api/v1/admin/prompts", admin, adminPromptsRouter);
app.use("/api/v1/admin/users", admin, adminUsersRouter);
app.use("/api/v1/admin/providers", admin, adminProvidersRouter);
app.use("/api/v1/admin/models", admin, adminModelsRouter);
app.use("/api/v1/admin/settings", admin, adminSettingsRouter);

app.use(errorHandler);

app.listen(env.port, async () => {
    await releaseStaleJobs();
    await cleanupExpiredUploads().catch((error) => logger.warn("清理过期上传失败", { message: error instanceof Error ? error.message : String(error) }));
    const cleanupTimer = setInterval(
        () => void cleanupExpiredUploads().catch((error) => logger.warn("清理过期上传失败", { message: error instanceof Error ? error.message : String(error) })),
        60 * 60 * 1000,
    );
    cleanupTimer.unref();
    logger.info(`后台服务已启动 http://127.0.0.1:${env.port}`);
});
