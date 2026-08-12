import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const videos = new Map();
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

createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://mock");
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname === "/control/stats") return send(res, 200, { requestCount, videos: videos.size });
    if (url.pathname === "/control/reset" && req.method === "POST") {
        requestCount = 0;
        videos.clear();
        return send(res, 200, { ok: true });
    }

    requestCount += 1;
    if (url.pathname.endsWith("/responses") && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const serialized = JSON.stringify(body.input || "");
        await wait(delayFrom(serialized));
        if (serialized.includes("[fail]")) return send(res, 502, { error: { message: "mock provider failure" } });
        return send(res, 200, {
            id: `response-${randomUUID()}`,
            output_text: "模拟供应商响应",
            usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        });
    }

    if (url.pathname.endsWith("/images/generations") && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        await wait(delayFrom(String(body.prompt || "")));
        return send(res, 200, {
            id: `image-${randomUUID()}`,
            data: Array.from({ length: Number(body.n) || 1 }, () => ({ b64_json: PNG.toString("base64") })),
        });
    }

    if (url.pathname.endsWith("/videos") && req.method === "POST") {
        const raw = (await readBody(req)).toString("latin1");
        const id = `video-${randomUUID()}`;
        videos.set(id, { readyAt: Date.now() + delayFrom(raw, 5000), cancelled: false });
        return send(res, 200, { id, status: "queued" });
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
}).listen(9999, "0.0.0.0");
