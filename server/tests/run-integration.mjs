import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(serverDir, "..");
const composeFile = path.join(rootDir, "docker-compose.test.yml");
const composeArgs = ["compose", "-f", composeFile, "-p", "infinite-canvas-test"];
const docker = process.env.DOCKER_BIN || ["/opt/homebrew/bin/docker", "/usr/local/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"].find(existsSync) || "docker";

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd || rootDir, env: { ...process.env, ...options.env }, stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`))));
    });
}

let passed = false;
let cleaning = false;
async function cleanup() {
    if (cleaning || process.env.KEEP_TEST_STACK === "true") return;
    cleaning = true;
    await run(docker, [...composeArgs, "down", "--volumes", "--remove-orphans"]).catch(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
}

try {
    await run(docker, [...composeArgs, "down", "--volumes", "--remove-orphans"]);
    await run(docker, [...composeArgs, "up", "-d", "--build", "--wait"]);
    await run("node", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/backend.integration.test.ts"], {
        cwd: serverDir,
        env: {
            TEST_API_URL: "http://127.0.0.1:58787",
            TEST_APP_URL: "http://127.0.0.1:53000",
            TEST_MOCK_URL: "http://127.0.0.1:59999",
            TEST_DATABASE_URL: "postgresql://infinite_canvas:integration_test@127.0.0.1:55432/infinite_canvas",
            TEST_COMPOSE_FILE: composeFile,
            TEST_COMPOSE_PROJECT: "infinite-canvas-test",
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
