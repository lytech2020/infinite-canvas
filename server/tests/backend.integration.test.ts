import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient, type AiUsageRecord } from "@prisma/client";

const execFileAsync = promisify(execFile);
for (const name of ["TEST_DATABASE_URL", "TEST_COMPOSE_FILE", "TEST_MOCK_URL", "TEST_MINIO_URL"] as const) {
    if (!process.env[name]) throw new Error(`缺少 ${name}，请通过 npm run test:integration 运行此测试`);
}
const API = process.env.TEST_API_URL || "http://127.0.0.1:58787";
const APP = process.env.TEST_APP_URL || "http://127.0.0.1:53000";
const DATABASE_URL = process.env.TEST_DATABASE_URL!;
const COMPOSE_FILE = process.env.TEST_COMPOSE_FILE!;
const COMPOSE_PROJECT = process.env.TEST_COMPOSE_PROJECT || "infinite-canvas-test";
const MOCK = process.env.TEST_MOCK_URL!;
const MINIO = process.env.TEST_MINIO_URL!;
const DOCKER = process.env.TEST_DOCKER_BIN || "docker";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
let serial = 0;

process.env.DATABASE_URL = DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.S3_ENDPOINT = MINIO;
process.env.S3_PUBLIC_ENDPOINT = MINIO;
process.env.S3_BUCKET = "infinite-canvas";
process.env.S3_ACCESS_KEY_ID = "infinite_canvas";
process.env.S3_SECRET_ACCESS_KEY = "integration_test";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.SESSION_COOKIE_SECURE = "false";
const s3 = new S3Client({
    region: "us-east-1",
    endpoint: MINIO,
    forcePathStyle: true,
    credentials: { accessKeyId: "infinite_canvas", secretAccessKey: "integration_test" },
});

type ApiResult<T = any> = { status: number; body: T; headers: Headers };

class Session {
    cookie = "";
    readonly forwardedFor: string;

    constructor(forwardedFor?: string) {
        const id = serial++;
        this.forwardedFor = forwardedFor || `198.18.${Math.floor(id / 250) % 250}.${(id % 250) + 1}`;
    }

    async request<T = any>(path: string, init: { method?: string; body?: unknown; csrf?: boolean; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
        const method = (init.method || "GET").toUpperCase();
        const headers: Record<string, string> = { "X-Forwarded-For": this.forwardedFor };
        if (this.cookie) headers.Cookie = this.cookie;
        if (init.body !== undefined) headers["Content-Type"] = "application/json";
        if (MUTATING.has(method) && init.csrf !== false) headers["X-Requested-With"] = "infinite-canvas";
        Object.assign(headers, init.headers);
        const response = await fetch(`${API}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(30_000) });
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";", 1)[0];
        return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
    }
}

function unique(prefix: string) {
    serial += 1;
    return `${prefix}-${serial}-${Date.now()}`;
}

async function login(email: string, password: string) {
    const session = new Session();
    const result = await session.request("/api/v1/auth/login", { method: "POST", body: { email, password } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return session;
}

async function createUser(admin: Session, prefix: string, password = "UserTest123!") {
    const email = `${unique(prefix)}@example.com`;
    const result = await admin.request("/api/v1/admin/users", { method: "POST", body: { email, password } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.user.dailyCallLimit, 20);
    return { email, password, user: result.body.data.user, session: await login(email, password) };
}

async function setLimits(admin: Session, userId: string, limits: { dailyCallLimit: number | null; concurrencyLimit: number | null; videoConcurrencyLimit: number | null }) {
    const result = await admin.request(`/api/v1/admin/users/${userId}/limits`, { method: "PATCH", body: limits });
    assert.equal(result.status, 200, JSON.stringify(result.body));
}

async function submit(session: Session, modelId: string, requestId: string, options: { capability?: "text" | "image" | "video" | "audio"; prompt?: string; params?: Record<string, unknown>; fileIds?: string[] } = {}) {
    const capability = options.capability || "text";
    return session.request("/api/v1/generations", {
        method: "POST",
        body: {
            requestId,
            modelId,
            capability,
            source: capability === "video" ? "video_workbench" : capability === "image" ? "image_workbench" : "other",
            prompt: options.prompt || "集成测试",
            params: options.params || {},
            fileIds: options.fileIds,
        },
    });
}

async function waitJob(session: Session, jobId: string, statuses = ["succeeded", "failed", "cancelled"], timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await session.request(`/api/v1/generations/${jobId}`);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        if (statuses.includes(result.body.data.job.status)) return result.body.data.job;
        await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`等待任务 ${jobId} 超时`);
}

async function waitForStatus(session: Session, jobId: string, status: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await session.request(`/api/v1/generations/${jobId}`);
        if (result.body.data?.job?.status === status) return result.body.data.job;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`任务 ${jobId} 未进入 ${status}`);
}

async function cancel(session: Session, jobId: string) {
    return session.request(`/api/v1/generations/${jobId}/cancel`, { method: "POST" });
}

async function mockReset() {
    const response = await fetch(`${MOCK}/control/reset`, { method: "POST", signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
}

async function mockStats() {
    const response = await fetch(`${MOCK}/control/stats`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ requestCount: number; paths: Record<string, number> }>;
}

async function waitForMockHold(token: string, entered: number, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const response = await fetch(`${MOCK}/control/hold/${token}`, { signal: AbortSignal.timeout(5_000) });
        const state = (await response.json()) as { entered: number };
        if (state.entered >= entered) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`供应商请求未进入 hold=${token}（期望 ${entered} 条）`);
}

async function waitForUsage(jobId: string, predicate: (usage: AiUsageRecord) => boolean, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const usage = await prisma.aiUsageRecord.findUnique({ where: { jobId } });
        if (usage && predicate(usage)) return usage;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`任务 ${jobId} 的用量记录未达到预期状态`);
}

async function waitForNoObjects(prefix: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const objects = await s3.send(new ListObjectsV2Command({ Bucket: "infinite-canvas", Prefix: prefix }));
        if (!(objects.KeyCount || 0)) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`对象前缀 ${prefix} 未被清理`);
}

async function releaseMock(token: string) {
    const response = await fetch(`${MOCK}/control/release/${token}`, { method: "POST", signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
}

async function compose(...args: string[]) {
    try {
        await execFileAsync(DOCKER, ["compose", "-f", COMPOSE_FILE, "-p", COMPOSE_PROJECT, ...args], { timeout: 300_000 });
    } catch (error) {
        const detail = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        throw new Error(`Docker Compose ${args.join(" ")} 失败${detail ? `：${detail.trim()}` : ""}`, { cause: error });
    }
}

async function waitHealth(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await fetch(`${API}/api/v1/health`).catch(() => null))?.ok) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("后台重启后健康检查超时");
}

async function waitUrl(url: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const response = await fetch(url).catch(() => null);
        if (response?.ok) return response;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`等待 ${url} 超时`);
}

test("云端后台安全与并发集成测试", { timeout: 600_000 }, async (t) => {
    t.afterEach(async () => {
        await mockReset();
    });
    const admin = await login("integration-admin@example.com", "AdminTest123!");
    const modelsResult = await admin.request("/api/v1/admin/models");
    assert.equal(modelsResult.status, 200);
    const models = modelsResult.body.data.items as Array<any>;
    const textModel = models.find((model) => model.capability === "text");
    const imageModel = models.find((model) => model.capability === "image");
    const videoModel = models.find((model) => model.capability === "video");
    assert.ok(textModel && imageModel && videoModel, "seed 应创建三种模拟模型");
    const seededProvider = (await admin.request("/api/v1/admin/providers")).body.data.items[0];

    await t.test("全新 Docker 环境自动迁移、seed 并提供前后台服务", async () => {
        assert.equal((await fetch(`${API}/api/v1/health`)).status, 200);
        assert.equal((await waitUrl(APP)).status, 200);
        const settings = await admin.request("/api/v1/admin/settings");
        assert.equal(settings.body.data.registrationOpen, false);
        const registration = await new Session().request("/api/v1/auth/register", { method: "POST", body: { email: `${unique("closed-registration")}@example.com`, password: "UserTest123!" } });
        assert.equal(registration.status, 403);
        assert.equal(registration.body.error?.code, "REGISTRATION_CLOSED");
        const cookieSession = new Session();
        const cookieLogin = await cookieSession.request("/api/v1/auth/login", { method: "POST", body: { email: "integration-admin@example.com", password: "AdminTest123!" } });
        const setCookie = cookieLogin.headers.get("set-cookie") || "";
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);
        await compose("exec", "-T", "-e", "ADMIN_PASSWORD=x", "server", "node", "dist/prisma/seed.js");
    });

    await t.test("登录限流按固定客户端 IP 拦截暴力尝试", async () => {
        const attacker = new Session("198.19.255.254");
        for (let index = 0; index < 20; index += 1) {
            const result = await attacker.request("/api/v1/auth/login", { method: "POST", body: { email: "integration-admin@example.com", password: "WrongPass123!" } });
            assert.equal(result.status, 401, `第 ${index + 1} 次错误登录应进入凭据校验`);
        }
        const limited = await attacker.request("/api/v1/auth/login", { method: "POST", body: { email: "integration-admin@example.com", password: "WrongPass123!" } });
        assert.equal(limited.status, 429);
        assert.equal(limited.body.error?.code, "RATE_LIMITED");
        assert.ok(limited.headers.get("retry-after"));
    });

    await t.test("同一 requestId 并发 20 次只创建一条任务和用量记录", async () => {
        await mockReset();
        const account = await createUser(admin, "idempotent");
        const requestId = unique("same-request");
        const token = unique("idempotent-hold");
        const results = await Promise.all(Array.from({ length: 20 }, () => submit(account.session, textModel.id, requestId, { prompt: `[hold=${token}] 幂等` })));
        assert.ok(results.every((result) => result.status === 200), JSON.stringify(results.map((result) => [result.status, result.body.error?.code])));
        const ids = new Set(results.map((result) => result.body.data.job.id));
        assert.equal(ids.size, 1);
        const jobId = [...ids][0] as string;
        await waitForMockHold(token, 1);
        assert.equal((await mockStats()).requestCount, 1, "幂等请求只能真实调用一次供应商");
        await releaseMock(token);
        assert.equal((await waitJob(account.session, jobId)).status, "succeeded");
        assert.equal((await mockStats()).requestCount, 1, "任务结束后仍只能有一次供应商调用");
        assert.equal(await prisma.generationJob.count({ where: { userId: account.user.id, requestId } }), 1);
        assert.equal(await prisma.aiUsageRecord.count({ where: { jobId } }), 1);
    });

    await t.test("用户并发与视频并发严格执行账户限额", async () => {
        await mockReset();
        const account = await createUser(admin, "concurrency");
        await setLimits(admin, account.user.id, { dailyCallLimit: 100, concurrencyLimit: 2, videoConcurrencyLimit: 1 });
        const textHold = unique("user-concurrency");
        const results = await Promise.all(Array.from({ length: 5 }, (_, index) => submit(account.session, textModel.id, unique(`parallel-${index}`), { prompt: `[hold=${textHold}] 并发` })));
        const accepted = results.filter((result) => result.status === 200);
        const rejected = results.filter((result) => result.body.error?.code === "CONCURRENCY_LIMIT");
        assert.equal(accepted.length, 2);
        assert.equal(rejected.length, 3);
        await waitForMockHold(textHold, 2);
        assert.equal((await mockStats()).requestCount, 2);
        await Promise.all(accepted.map((result) => cancel(account.session, result.body.data.job.id)));
        await releaseMock(textHold);

        await mockReset();
        const videoHold = unique("video-concurrency");
        const videoResults = await Promise.all(Array.from({ length: 3 }, (_, index) => submit(account.session, videoModel.id, unique(`video-${index}`), { capability: "video", prompt: `[hold=${videoHold}] 视频并发`, params: { seconds: 4 } })));
        assert.equal(videoResults.filter((result) => result.status === 200).length, 1);
        assert.equal(videoResults.filter((result) => result.body.error?.code === "CONCURRENCY_LIMIT").length, 2);
        const videoJob = videoResults.find((result) => result.status === 200)!;
        await waitForMockHold(videoHold, 1);
        assert.equal((await mockStats()).requestCount, 1);
        await cancel(account.session, videoJob.body.data.job.id);
        await releaseMock(videoHold);
    });

    await t.test("模型 maxConcurrency=1 时多用户只放行一条", async () => {
        const patch = await admin.request(`/api/v1/admin/models/${textModel.id}`, { method: "PATCH", body: { maxConcurrency: 1 } });
        assert.equal(patch.status, 200);
        try {
            await mockReset();
            const first = await createUser(admin, "model-limit-a");
            const second = await createUser(admin, "model-limit-b");
            const token = unique("model-concurrency");
            const results = await Promise.all([
                submit(first.session, textModel.id, unique("model-a"), { prompt: `[hold=${token}] 模型并发` }),
                submit(second.session, textModel.id, unique("model-b"), { prompt: `[hold=${token}] 模型并发` }),
            ]);
            assert.equal(results.filter((result) => result.status === 200).length, 1);
            assert.equal(results.filter((result) => result.body.error?.code === "SERVICE_BUSY").length, 1);
            const accepted = results.find((result) => result.status === 200)!;
            await waitForMockHold(token, 1);
            assert.equal((await mockStats()).requestCount, 1);
            await cancel(accepted === results[0] ? first.session : second.session, accepted.body.data.job.id);
            await releaseMock(token);
        } finally {
            await admin.request(`/api/v1/admin/models/${textModel.id}`, { method: "PATCH", body: { maxConcurrency: null } });
        }
    });

    await t.test("取消 queued、running 和供应商已返回竞态均保持正确用量", async () => {
        const account = await createUser(admin, "cancel");
        const queued = await prisma.generationJob.create({
            data: { requestId: unique("queued"), userId: account.user.id, source: "other", modelId: textModel.id, capability: "text", promptText: "queued", status: "queued" },
        });
        const queuedCancel = await cancel(account.session, queued.id);
        assert.equal(queuedCancel.body.data.job.status, "cancelled");
        assert.equal((await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: queued.id } })).usageSource, "none");

        await mockReset();
        const runningHold = unique("running-cancel");
        const runningResult = await submit(account.session, textModel.id, unique("running"), { prompt: `[hold=${runningHold}] 运行中取消` });
        await waitForStatus(account.session, runningResult.body.data.job.id, "running");
        await waitForMockHold(runningHold, 1);
        await cancel(account.session, runningResult.body.data.job.id);
        assert.equal((await waitJob(account.session, runningResult.body.data.job.id)).status, "cancelled");
        assert.equal((await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: runningResult.body.data.job.id } })).usageSource, "none");
        await releaseMock(runningHold);

        const lateJob = await prisma.generationJob.create({
            data: { requestId: unique("late"), userId: account.user.id, source: "other", modelId: textModel.id, capability: "text", promptText: "late", status: "cancelled", finishedAt: new Date() },
        });
        await prisma.aiUsageRecord.create({ data: { jobId: lateJob.id, userId: account.user.id, modelId: textModel.id, capability: "text", status: "cancelled", usageSource: "none" } });
        const { recordSucceededUsage } = await import("../src/modules/usage/service.js");
        const outcome = await recordSucceededUsage(lateJob.id, { providerUsage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }, { result: { text: "late" } });
        assert.equal(outcome, "cancelled");
        const lateUsage = await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: lateJob.id } });
        assert.equal(lateUsage.status, "cancelled");
        assert.equal(lateUsage.totalTokens, 120);

        await mockReset();
        const lateImageHold = unique("late-image-cancel");
        const lateImage = await submit(account.session, imageModel.id, unique("late-image"), { capability: "image", prompt: `[hold=${lateImageHold}] 供应商返回后取消` });
        const lateImageId = lateImage.body.data.job.id;
        await waitForMockHold(lateImageHold, 1);
        await prisma.$transaction([
            prisma.generationJob.update({ where: { id: lateImageId }, data: { status: "cancelled", finishedAt: new Date() } }),
            prisma.aiUsageRecord.create({ data: { jobId: lateImageId, userId: account.user.id, modelId: imageModel.id, capability: "image", status: "cancelled", usageSource: "none" } }),
        ]);
        await releaseMock(lateImageHold);
        const settledLateImage = await waitForUsage(lateImageId, (usage) => usage.status === "cancelled" && Boolean(usage.mediaUnits));
        assert.equal((settledLateImage.mediaUnits as { images: number }).images, 1);
        const lateImageStats = await mockStats();
        assert.equal(Object.entries(lateImageStats.paths).filter(([path]) => path.endsWith("/images/generations")).reduce((sum, [, count]) => sum + count, 0), 1);
        await waitForNoObjects(`outputs/${account.user.id}/${lateImageId}/`);
    });

    await t.test("每日额度在并发下生效", async () => {
        await mockReset();
        const daily = await createUser(admin, "daily-limit");
        await setLimits(admin, daily.user.id, { dailyCallLimit: 1, concurrencyLimit: 5, videoConcurrencyLimit: 1 });
        const dailyHold = unique("daily-limit");
        const dailyResults = await Promise.all(Array.from({ length: 5 }, (_, index) => submit(daily.session, textModel.id, unique(`daily-${index}`), { prompt: `[hold=${dailyHold}] 日限额` })));
        assert.equal(dailyResults.filter((result) => result.status === 200).length, 1);
        assert.equal(dailyResults.filter((result) => result.body.error?.code === "DAILY_CALL_LIMIT").length, 4);
        await waitForMockHold(dailyHold, 1);
        await cancel(daily.session, dailyResults.find((result) => result.status === 200)!.body.data.job.id);
        await releaseMock(dailyHold);
    });

    await t.test("管理员跳过次数限制但仍受并发限制", async () => {
        await prisma.user.update({ where: { email: "integration-admin@example.com" }, data: { dailyCallLimit: 1, concurrencyLimit: 2 } });
        try {
            const completed = await submit(admin, textModel.id, unique("admin-complete"));
            await waitJob(admin, completed.body.data.job.id);
            await mockReset();
            const token = unique("admin-concurrency");
            const results = await Promise.all(Array.from({ length: 3 }, (_, index) => submit(admin, textModel.id, unique(`admin-${index}`), { prompt: `[hold=${token}] 管理员并发` })));
            assert.equal(results.filter((result) => result.status === 200).length, 2);
            assert.equal(results.filter((result) => result.body.error?.code === "CONCURRENCY_LIMIT").length, 1);
            await waitForMockHold(token, 2);
            await Promise.all(results.filter((result) => result.status === 200).map((result) => cancel(admin, result.body.data.job.id)));
            await releaseMock(token);
        } finally {
            await prisma.user.update({ where: { email: "integration-admin@example.com" }, data: { dailyCallLimit: null, concurrencyLimit: null } });
        }
    });

    await t.test("图片、视频与音频成功路径记录实际媒体用量", async () => {
        const account = await createUser(admin, "media-settlement");
        const createModel = async (capability: "image" | "video" | "audio", remoteName: string) => {
            const result = await admin.request("/api/v1/admin/models", {
                method: "POST",
                body: { providerId: seededProvider.id, displayName: unique(`${capability}-settlement`), remoteName, capability },
            });
            assert.equal(result.status, 200, JSON.stringify(result.body));
            return result.body.data.model;
        };

        const image = await createModel("image", "mock-image");
        const imageCreated = await submit(account.session, image.id, unique("variant-image"), { capability: "image", params: { size: "1024x1024", quality: "high", count: 1 } });
        await waitJob(account.session, imageCreated.body.data.job.id);
        const imageUsage = await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: imageCreated.body.data.job.id } });
        assert.equal((imageUsage.mediaUnits as { images: number }).images, 1);

        const video = await createModel("video", "mock-video");
        const videoCreated = await submit(account.session, video.id, unique("media-video"), { capability: "video", prompt: "[delay=1] 视频用量", params: { seconds: 4, resolution: "1080p" } });
        await waitJob(account.session, videoCreated.body.data.job.id, ["succeeded", "failed"], 15_000);
        const videoUsage = await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: videoCreated.body.data.job.id } });
        assert.equal((videoUsage.mediaUnits as { videoSeconds: number }).videoSeconds, 4);

        const roundedVideo = await submit(account.session, video.id, unique("rounded-video"), { capability: "video", prompt: "[delay=1] 视频时长进位", params: { seconds: 5, resolution: "1080p" } });
        await waitJob(account.session, roundedVideo.body.data.job.id, ["succeeded", "failed"], 15_000);
        const roundedVideoUsage = await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: roundedVideo.body.data.job.id } });
        assert.equal((roundedVideoUsage.mediaUnits as { videoSeconds: number }).videoSeconds, 8);

        const audio = await createModel("audio", "mock-audio");
        const audioCreated = await submit(account.session, audio.id, unique("media-audio"), { capability: "audio", prompt: "测试音频", params: { format: "wav" } });
        await waitJob(account.session, audioCreated.body.data.job.id);
        const audioUsage = await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: audioCreated.body.data.job.id } });
        assert.equal((audioUsage.mediaUnits as { audioCharacters: number }).audioCharacters, 4);
    });

    await t.test("生成硬上限和供应商失败路径均留下稳定结果", async () => {
        const account = await createUser(admin, "hard-limits");
        const cases = [
            submit(account.session, imageModel.id, unique("count-limit"), { capability: "image", params: { count: 11 } }),
            submit(account.session, textModel.id, unique("token-limit"), { params: { maxOutputTokens: 32_769 } }),
            submit(account.session, videoModel.id, unique("seconds-limit"), { capability: "video", params: { seconds: 61 } }),
            submit(account.session, textModel.id, unique("messages-limit"), { params: { messages: Array.from({ length: 101 }, () => ({ role: "user", content: "x" })) } }),
            submit(account.session, textModel.id, unique("prompt-limit"), { prompt: "x".repeat(20_001) }),
        ];
        const results = await Promise.all(cases);
        assert.ok(results.every((result) => result.body.error?.code === "VALIDATION_FAILED"), JSON.stringify(results.map((result) => result.body)));

        const failed = await submit(account.session, textModel.id, unique("provider-failure"), { prompt: "[fail]" });
        const failedJob = await waitJob(account.session, failed.body.data.job.id);
        assert.equal(failedJob.status, "failed");
        assert.equal(failedJob.errorCode, "PROVIDER_ERROR");
        assert.equal((await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId: failedJob.id } })).usageSource, "none");
    });

    await t.test("生成、上传频率和待上传记录上限生效", async () => {
        const generationAccount = await createUser(admin, "generation-rate");
        const requestId = unique("rate-same-request");
        const generationResults = [];
        for (let index = 0; index < 61; index += 1) generationResults.push(await submit(generationAccount.session, textModel.id, requestId));
        assert.ok(generationResults.slice(0, 60).every((result) => result.status === 200));
        assert.equal(generationResults[60].body.error?.code, "RATE_LIMITED");
        await waitJob(generationAccount.session, generationResults[0].body.data.job.id);

        const uploadAccount = await createUser(admin, "upload-rate");
        for (let index = 0; index < 120; index += 1) {
            const result = await uploadAccount.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: 68 } });
            assert.equal(result.status, 200, `第 ${index + 1} 次上传签名应成功`);
            await prisma.upload.delete({ where: { id: result.body.data.uploadId } });
        }
        const uploadLimited = await uploadAccount.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: 68 } });
        assert.equal(uploadLimited.body.error?.code, "RATE_LIMITED");
        assert.ok(uploadLimited.headers.get("retry-after"));

        const pendingAccount = await createUser(admin, "pending-limit");
        await prisma.upload.createMany({
            data: Array.from({ length: 100 }, (_, index) => ({
                userId: pendingAccount.user.id,
                storageKey: `uploads/${pendingAccount.user.id}/pending-${index}`,
                mimeType: "image/png",
                size: 68,
                status: "pending",
                expiresAt: new Date(Date.now() + 10 * 60_000),
            })),
        });
        const pendingLimited = await pendingAccount.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: 68 } });
        assert.equal(pendingLimited.body.error?.code, "RATE_LIMITED");
        assert.equal(pendingLimited.body.error?.details?.maxPending, 100);
    });

    await t.test("普通用户不能访问管理接口，且跨用户资源统一不可见", async () => {
        const a = await createUser(admin, "owner-a");
        const b = await createUser(admin, "owner-b");
        for (const path of ["overview", "usage", "prompts", "users", "providers", "models", "settings"]) {
            const result = await a.session.request(`/api/v1/admin/${path}`);
            assert.equal(result.status, 403, path);
            assert.equal(result.body.error?.code, "FORBIDDEN", path);
        }
        const forbiddenLimits = await a.session.request(`/api/v1/admin/users/${b.user.id}/limits`, {
            method: "PATCH",
            body: { dailyCallLimit: 1, concurrencyLimit: 1, videoConcurrencyLimit: 1 },
        });
        assert.equal(forbiddenLimits.status, 403);
        const projectId = unique("project-b");
        await b.session.request("/api/v1/projects", { method: "POST", body: { id: projectId, name: "B 项目" } });
        assert.equal((await a.session.request(`/api/v1/projects/${projectId}`)).status, 404);
        const job = await submit(b.session, textModel.id, unique("job-b"));
        assert.equal((await a.session.request(`/api/v1/generations/${job.body.data.job.id}`)).status, 404);
        await waitJob(b.session, job.body.data.job.id);

        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
        const presign = await b.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: png.length } });
        assert.equal((await fetch(presign.body.data.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).status, 200);
        await b.session.request(`/api/v1/uploads/${presign.body.data.uploadId}/complete`, { method: "POST" });
        assert.equal((await a.session.request(`/api/v1/uploads/${presign.body.data.uploadId}/complete`, { method: "POST" })).status, 404);
        const foreignFile = await submit(a.session, imageModel.id, unique("foreign-upload"), { capability: "image", fileIds: [presign.body.data.uploadId] });
        assert.equal(foreignFile.status, 404);
    });

    await t.test("停用账号、改密会话与密码边界符合规则", async () => {
        for (const password of ["1234567", "12345678901234567"]) {
            const result = await admin.request("/api/v1/admin/users", { method: "POST", body: { email: `${unique("bad-password")}@example.com`, password } });
            assert.equal(result.body.error?.code, "VALIDATION_FAILED");
        }
        for (const password of ["Abc123!x", "Abcdef12345!xyzq"]) {
            assert.ok(password.length === 8 || password.length === 16);
            const account = await createUser(admin, "password-boundary", password);
            assert.ok(account.session.cookie);
        }

        const disabled = await createUser(admin, "disabled");
        await admin.request(`/api/v1/admin/users/${disabled.user.id}/status`, { method: "PATCH", body: { status: "disabled" } });
        const disabledRequest = await disabled.session.request("/api/v1/models");
        assert.equal(disabledRequest.status, 401);
        assert.equal(disabledRequest.body.error?.code, "AUTH_REQUIRED");
        const disabledLogin = await new Session().request("/api/v1/auth/login", { method: "POST", body: { email: disabled.email, password: disabled.password } });
        assert.equal(disabledLogin.status, 403);
        assert.equal(disabledLogin.body.error?.code, "ACCOUNT_DISABLED");

        const passwordAccount = await createUser(admin, "password-session");
        const otherDevice = await login(passwordAccount.email, passwordAccount.password);
        const changed = await passwordAccount.session.request("/api/v1/auth/password", { method: "POST", body: { currentPassword: passwordAccount.password, newPassword: "NewPass123!" } });
        assert.equal(changed.status, 200);
        assert.equal((await passwordAccount.session.request("/api/v1/models")).status, 200);
        assert.equal((await otherDevice.request("/api/v1/models")).status, 401);
        const noCsrf = await passwordAccount.session.request("/api/v1/projects", { method: "POST", body: { id: unique("csrf"), name: "CSRF" }, csrf: false });
        assert.equal(noCsrf.status, 403);
        const invalidCsrf = await passwordAccount.session.request("/api/v1/projects", {
            method: "POST",
            body: { id: unique("invalid-csrf"), name: "非法 CSRF 头" },
            headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        assert.equal(invalidCsrf.status, 403);
    });

    await t.test("上传声明大小、实际大小、真实类型和跨用户引用均校验", async () => {
        const account = await createUser(admin, "upload");
        const oversized = await account.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: 100 * 1024 * 1024 } });
        assert.equal(oversized.body.error?.code, "FILE_TOO_LARGE");

        const declared = 1024 * 1024;
        const mismatch = await account.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: declared } });
        const pngHeader = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
        const actual = Buffer.concat([pngHeader, Buffer.alloc(10 * 1024 * 1024 - pngHeader.length)]);
        const put = await fetch(mismatch.body.data.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: actual });
        assert.equal(put.status, 403, "签名长度约束应在上传阶段直接拒绝");

        const backendMismatch = await account.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: declared } });
        const upload = await prisma.upload.findUniqueOrThrow({ where: { id: backendMismatch.body.data.uploadId } });
        await s3.send(new PutObjectCommand({ Bucket: "infinite-canvas", Key: upload.storageKey, Body: actual, ContentType: "image/png" }));
        const complete = await account.session.request(`/api/v1/uploads/${upload.id}/complete`, { method: "POST" });
        assert.equal(complete.body.error?.code, "VALIDATION_FAILED");
        await assert.rejects(
            () => s3.send(new HeadObjectCommand({ Bucket: "infinite-canvas", Key: upload.storageKey })),
            (error: any) => error?.$metadata?.httpStatusCode === 404,
            "后端发现实际大小不一致后应删除对象",
        );

        const fake = Buffer.from("not an image");
        const fakePresign = await account.session.request("/api/v1/uploads/presign", { method: "POST", body: { mimeType: "image/png", size: fake.length } });
        await fetch(fakePresign.body.data.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: fake });
        const fakeComplete = await account.session.request(`/api/v1/uploads/${fakePresign.body.data.uploadId}/complete`, { method: "POST" });
        assert.equal(fakeComplete.body.error?.code, "FILE_TYPE_NOT_ALLOWED");
    });

    await t.test("下载签名过期后重新查询任务可获得新地址", async () => {
        const account = await createUser(admin, "download-ttl");
        const created = await submit(account.session, imageModel.id, unique("download-image"), { capability: "image" });
        const job = await waitJob(account.session, created.body.data.job.id);
        const firstUrl = job.result.files[0].url;
        assert.equal((await fetch(firstUrl)).status, 200);
        await new Promise((resolve) => setTimeout(resolve, 13_000));
        assert.equal((await fetch(firstUrl)).status, 403);
        const refreshed = await account.session.request(`/api/v1/generations/${job.id}`);
        const secondUrl = refreshed.body.data.job.result.files[0].url;
        assert.equal((await fetch(secondUrl)).status, 200);
    });

    await t.test("整栈 down/up 后数据库和 MinIO 数据仍然保留", async () => {
        const account = await createUser(admin, "stack-persistence");
        const created = await submit(account.session, imageModel.id, unique("persistent-image"), { capability: "image" });
        const completed = await waitJob(account.session, created.body.data.job.id);
        assert.equal(completed.status, "succeeded");
        await compose("down");
        await compose("up", "-d", "--wait");
        await waitHealth();
        const restoredSession = await login(account.email, account.password);
        const restored = await restoredSession.request(`/api/v1/generations/${created.body.data.job.id}`);
        assert.equal(restored.body.data.job.status, "succeeded");
        assert.equal((await fetch(restored.body.data.job.result.files[0].url)).status, 200);
    });

    await t.test("供应商响应期间终止后台，重启后任务失败并留下用量记录", async () => {
        await mockReset();
        const account = await createUser(admin, "restart");
        const token = unique("restart-hold");
        const created = await submit(account.session, textModel.id, unique("kill-server"), { prompt: `[hold=${token}] 重启恢复` });
        const jobId = created.body.data.job.id;
        await waitForStatus(account.session, jobId, "running");
        await waitForMockHold(token, 1);
        assert.equal((await mockStats()).requestCount, 1);
        try {
            const changedProvider = await admin.request(`/api/v1/admin/providers/${seededProvider.id}`, { method: "PATCH", body: { baseUrl: "http://mock-provider:9999/changed", enabled: false } });
            assert.equal(changedProvider.status, 200);
            await compose("kill", "server");
            await releaseMock(token);
            await compose("up", "-d", "server");
            await waitHealth();
            const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
            assert.equal(job.status, "failed");
            assert.equal((await prisma.aiUsageRecord.findUniqueOrThrow({ where: { jobId } })).usageSource, "none");
            assert.equal((await mockStats()).requestCount, 1, "重启不得重放遗留供应商请求");
            const providerAfterRestart = await prisma.provider.findUniqueOrThrow({ where: { id: seededProvider.id } });
            assert.equal(providerAfterRestart.baseUrl, "http://mock-provider:9999/changed");
            assert.equal(providerAfterRestart.enabled, false);
            assert.equal((await login(account.email, account.password)).cookie.length > 0, true, "重启后数据和账号应保留");
        } finally {
            await prisma.provider.update({ where: { id: seededProvider.id }, data: { baseUrl: seededProvider.baseUrl, enabled: seededProvider.enabled } });
        }
    });
});

test.after(async () => {
    await prisma.$disconnect();
});
