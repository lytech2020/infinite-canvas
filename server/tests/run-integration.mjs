import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(serverDir, "..");
const composeFile = path.join(rootDir, "docker-compose.test.yml");
const docker = process.env.DOCKER_BIN || ["/opt/homebrew/bin/docker", "/usr/local/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"].find(existsSync) || "docker";
const runId = (process.env.TEST_RUN_ID || String(process.pid)).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
const composeProject = `infinite-canvas-test-${runId}`;
const composeArgs = ["compose", "-f", composeFile, "-p", composeProject];

function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("无法分配测试端口"));
            server.close((error) => (error ? reject(error) : resolve(address.port)));
        });
    });
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd || rootDir, env: { ...process.env, ...options.env }, stdio: "inherit" });
        const timeout = options.timeoutMs
            ? setTimeout(() => {
                  child.kill("SIGTERM");
                  reject(new Error(`${command} 执行超过 ${Math.round(options.timeoutMs / 1000)} 秒`));
              }, options.timeoutMs)
            : undefined;
        child.on("error", (error) => {
            if (timeout) clearTimeout(timeout);
            reject(error);
        });
        child.on("exit", (code, signal) => {
            if (timeout) clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error(`${command} 失败（${signal ? `信号 ${signal}` : `退出码 ${code}`}）`));
        });
    });
}

const ports = await Promise.all(Array.from({ length: 6 }, freePort));
if (new Set(ports).size !== ports.length) throw new Error("动态测试端口发生重复，请重新运行测试");
const [appPort, apiPort, dbPort, minioPort, minioConsolePort, mockPort] = ports;
const composeEnv = {
    TEST_APP_PORT: String(appPort),
    TEST_API_PORT: String(apiPort),
    TEST_DB_PORT: String(dbPort),
    TEST_MINIO_PORT: String(minioPort),
    TEST_MINIO_CONSOLE_PORT: String(minioConsolePort),
    TEST_MOCK_PORT: String(mockPort),
};
console.log(`Docker 集成测试项目：${composeProject}`);

let passed = false;
let cleanupPromise;
function cleanup() {
    if (process.env.KEEP_TEST_STACK === "true") return Promise.resolve();
    cleanupPromise ??= run(docker, [...composeArgs, "down", "--volumes", "--remove-orphans", "--rmi", "local"], { env: composeEnv, timeoutMs: 120_000 }).catch((error) => {
        process.exitCode = 1;
        console.error(`清理 Docker 测试栈失败（项目 ${composeProject}）`, error);
    });
    return cleanupPromise;
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
        await cleanup();
        process.exit(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129);
    });
}

try {
    await run(docker, ["compose", "version"], { timeoutMs: 30_000 }).catch((error) => {
        throw new Error(`无法使用 Docker Compose V2，请确认 Docker 已启动且支持 \"docker compose\"：${error.message}`);
    });
    await run(docker, [...composeArgs, "down", "--volumes", "--remove-orphans"], { env: composeEnv, timeoutMs: 120_000 }).catch((error) => {
        console.warn(`测试前清理旧栈失败，将继续由 compose up 验证环境：${error.message}`);
    });
    await run(docker, [...composeArgs, "up", "-d", "--build", "--wait"], { env: composeEnv, timeoutMs: 1_200_000 });
    await run("node", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/backend.integration.test.ts"], {
        cwd: serverDir,
        timeoutMs: 900_000,
        env: {
            ...composeEnv,
            TEST_API_URL: `http://127.0.0.1:${apiPort}`,
            TEST_APP_URL: `http://127.0.0.1:${appPort}`,
            TEST_MOCK_URL: `http://127.0.0.1:${mockPort}`,
            TEST_MINIO_URL: `http://127.0.0.1:${minioPort}`,
            TEST_DATABASE_URL: `postgresql://infinite_canvas:integration_test@127.0.0.1:${dbPort}/infinite_canvas`,
            TEST_COMPOSE_FILE: composeFile,
            TEST_COMPOSE_PROJECT: composeProject,
            TEST_DOCKER_BIN: docker,
        },
    });
    passed = true;
} catch (error) {
    process.exitCode = 1;
    console.error(error);
} finally {
    await cleanup();
}

if (!passed) process.exitCode = 1;
