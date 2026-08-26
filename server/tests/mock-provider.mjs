import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const WAV = (() => {
    const sampleRate = 8000;
    const dataLength = sampleRate * 2;
    const buffer = Buffer.alloc(44 + dataLength);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write("WAVEfmt ", 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
})();
const videos = new Map();
const holds = new Map();
const releasedTokens = new Set();
const paths = new Map();
let requestCount = 0;

function send(res, status, body, contentType = "application/json") {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(status, { "content-type": contentType, "content-length": data.length });
    res.end(data);
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function delayFrom(value, fallback = 150) {
    const match = /\[delay=(\d{1,5})\]/.exec(value);
    return match ? Number(match[1]) : fallback;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function holdToken(value) {
    return /\[hold=([a-zA-Z0-9_-]{1,80})\]/.exec(value)?.[1];
}

async function waitForRelease(value) {
    const token = holdToken(value);
    if (!token || releasedTokens.has(token)) return;
    let state = holds.get(token);
    if (!state) {
        let release;
        const promise = new Promise((resolve) => {
            release = resolve;
        });
        state = { entered: 0, released: false, promise, release };
        holds.set(token, state);
    }
    state.entered += 1;
    await state.promise;
}

function resetControls() {
    for (const [token, state] of holds) {
        releasedTokens.add(token);
        state.release();
    }
    holds.clear();
    paths.clear();
    videos.clear();
    requestCount = 0;
}

async function handleRequest(req, res) {
    const url = new URL(req.url || "/", "http://mock");
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname === "/control/stats") return send(res, 200, { requestCount, paths: Object.fromEntries(paths), videos: videos.size });
    const holdMatch = /^\/control\/hold\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
    if (holdMatch) {
        const state = holds.get(holdMatch[1]);
        return send(res, 200, { entered: state?.entered || 0, released: state?.released || false });
    }
    const releaseMatch = /^\/control\/release\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
    if (releaseMatch && req.method === "POST") {
        const state = holds.get(releaseMatch[1]);
        releasedTokens.add(releaseMatch[1]);
        if (state && !state.released) {
            state.released = true;
            state.release();
        }
        return send(res, 200, { ok: true, entered: state?.entered || 0 });
    }
    if (url.pathname === "/control/reset" && req.method === "POST") {
        resetControls();
        return send(res, 200, { ok: true });
    }

    requestCount += 1;
    paths.set(url.pathname, (paths.get(url.pathname) || 0) + 1);
    if (url.pathname.endsWith("/responses") && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const serialized = JSON.stringify(body.input || "");
        await waitForRelease(serialized);
        await wait(delayFrom(serialized));
        if (serialized.includes("[fail]")) return send(res, 502, { error: { message: "mock provider failure" } });
        const detailed = serialized.includes("[detailed-usage]");
        return send(res, 200, {
            id: `response-${randomUUID()}`,
            output_text: "模拟供应商响应",
            usage: detailed
                ? { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120 }
                : { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        });
    }

    if (url.pathname.endsWith("/images/generations") && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        await waitForRelease(String(body.prompt || ""));
        await wait(delayFrom(String(body.prompt || "")));
        return send(res, 200, {
            id: `image-${randomUUID()}`,
            data: Array.from({ length: Number(body.n) || 1 }, () => ({ b64_json: PNG.toString("base64") })),
        });
    }

    if (url.pathname.endsWith("/images") && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const references = body.input_references;
        if (
            body.prompt === "保留参考图主体" &&
            (!Array.isArray(references) || !references.every((reference) => reference?.type === "image_url" && reference.image_url?.url?.startsWith("data:image/")))
        ) {
            return send(res, 400, { error: { message: "invalid input_references" } });
        }
        if (body.prompt === "[unsafe-html]") return send(res, 200, { data: [{ b64_json: Buffer.from("<html>unsafe</html>").toString("base64"), media_type: "text/html" }] });
        return send(res, 200, {
            id: `image-${randomUUID()}`,
            data: Array.from({ length: Number(body.n) || 1 }, () => ({ b64_json: PNG.toString("base64"), media_type: "image/png" })),
        });
    }

    if (url.pathname.endsWith("/videos") && req.method === "POST") {
        const raw = (await readBody(req)).toString("latin1");
        await waitForRelease(raw);
        const id = `video-${randomUUID()}`;
        videos.set(id, { readyAt: Date.now() + delayFrom(raw, 5000), cancelled: false });
        return send(res, 200, { id, status: "queued" });
    }

    if (url.pathname.endsWith("/audio/speech") && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        await waitForRelease(String(body.input || ""));
        await wait(delayFrom(String(body.input || "")));
        return send(res, 200, WAV, "audio/wav");
    }

    const videoMatch = /\/videos\/([^/]+)(?:\/(content))?$/.exec(url.pathname);
    if (videoMatch) {
        const state = videos.get(videoMatch[1]);
        if (!state) return send(res, 404, { error: { message: "video not found" } });
        if (req.method === "DELETE") {
            state.cancelled = true;
            return send(res, 200, { id: videoMatch[1], status: "cancelled" });
        }
        if (videoMatch[2] === "content") return send(res, 200, Buffer.from("mock-video"), "video/mp4");
        if (state.cancelled) return send(res, 200, { id: videoMatch[1], status: "cancelled" });
        return send(res, 200, { id: videoMatch[1], status: Date.now() >= state.readyAt ? "completed" : "running" });
    }

    send(res, 404, { error: { message: `unhandled mock route ${req.method} ${url.pathname}` } });
}

createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
        console.error("mock provider request failed", { method: req.method, url: req.url, error: error instanceof Error ? error.message : String(error) });
        if (!res.headersSent && !res.destroyed) send(res, 500, { error: { message: "mock provider internal error" } });
        else if (!res.destroyed) res.destroy();
    });
}).listen(9999, "0.0.0.0");
