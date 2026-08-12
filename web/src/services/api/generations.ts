import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiTextMessage } from "@/services/api/image";
import { BackendError, backendRequest } from "@/services/api/backend";
import type { ReferenceImage } from "@/types/image";

export type CloudGenerationContext = {
    source?: "canvas" | "image_workbench" | "video_workbench" | "other";
    projectId?: string;
    projectName?: string;
    nodeId?: string;
    requestId?: string;
};

export type GenerationJob = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    result: { text?: string; files?: Array<{ url: string; mimeType: string; size: number }> } | null;
    errorCode?: string | null;
};

type CreateGeneration = CloudGenerationContext & {
    modelId: string;
    capability: "text" | "image" | "audio" | "video";
    prompt: string;
    params?: Record<string, unknown>;
    references?: ReferenceImage[];
    mask?: ReferenceImage;
    files?: Array<{ blob: Blob; role: "reference_image" | "reference_video" | "reference_audio" }>;
    signal?: AbortSignal;
};

const POLL_INTERVAL_MS = 800;

export async function runCloudGeneration(input: CreateGeneration) {
    return waitForJob(await createCloudGeneration(input), input.signal);
}

export async function createCloudGeneration(input: CreateGeneration) {
    const context = resolveContext(input);
    const [referenceFileIds, maskFileId, uploadedFiles] = await Promise.all([
        input.references?.length ? Promise.all(input.references.map((reference) => uploadReference(reference, input.signal))) : Promise.resolve([]),
        input.mask ? uploadReference(input.mask, input.signal) : Promise.resolve(undefined),
        input.files?.length
            ? Promise.all(input.files.map(async (file) => ({ id: await uploadBlob(file.blob, input.signal), role: file.role })))
            : Promise.resolve([]),
    ]);
    const fileIds = [...referenceFileIds, ...uploadedFiles.map((file) => file.id), ...(maskFileId ? [maskFileId] : [])];
    const { job } = await backendRequest<{ job: GenerationJob }>("/generations", {
        method: "POST",
        signal: input.signal,
        body: {
            requestId: input.requestId || nanoid(),
            modelId: input.modelId,
            capability: input.capability,
            source: context.source,
            projectId: context.projectId,
            projectName: context.projectName,
            nodeId: context.nodeId,
            prompt: input.prompt,
            params: { ...(input.params || {}), ...(maskFileId ? { maskFileId } : {}), ...(uploadedFiles.length ? { fileRoles: uploadedFiles } : {}) },
            fileIds: fileIds.length ? fileIds : undefined,
        },
    });
    return job;
}

export async function fetchCloudGeneration(jobId: string, signal?: AbortSignal) {
    return (await backendRequest<{ job: GenerationJob }>(`/generations/${jobId}`, { signal })).job;
}

function resolveContext(input: CreateGeneration): CloudGenerationContext & { source: NonNullable<CloudGenerationContext["source"]> } {
    if (input.source) return { source: input.source, projectId: input.projectId, projectName: input.projectName, nodeId: input.nodeId, requestId: input.requestId };
    const canvasProjectId = typeof window === "undefined" ? "" : window.location.pathname.match(/^\/canvas\/([^/]+)/)?.[1] || "";
    if (canvasProjectId) return { source: "canvas", projectId: decodeURIComponent(canvasProjectId), projectName: input.projectName, nodeId: input.nodeId, requestId: input.requestId };
    return { source: input.capability === "image" ? "image_workbench" : input.capability === "video" ? "video_workbench" : "other", projectId: input.projectId, projectName: input.projectName, nodeId: input.nodeId, requestId: input.requestId };
}

export function textMessages(messages: AiTextMessage[]) {
    return messages
        .map((message) => {
            const content = Array.isArray(message.content) ? message.content.filter((item) => item.type === "text").map((item) => item.text).join("\n") : message.content;
            return { role: message.role, content: content.trim() };
        })
        .filter((message) => Boolean(message.content));
}

export function lastUserPrompt(messages: AiTextMessage[]) {
    const prepared = textMessages(messages);
    return [...prepared].reverse().find((message) => message.role === "user")?.content || prepared[prepared.length - 1]?.content || "";
}

export function messageImages(messages: AiTextMessage[]): ReferenceImage[] {
    return messages.flatMap((message, messageIndex) =>
        Array.isArray(message.content)
            ? message.content.flatMap((item, itemIndex) =>
                  item.type === "image_url" ? [{ id: `message-${messageIndex}-${itemIndex}`, name: `reference-${messageIndex + 1}-${itemIndex + 1}.png`, type: mimeTypeOf(item.image_url.url), dataUrl: item.image_url.url }] : [],
              )
            : [],
    );
}

async function uploadReference(reference: ReferenceImage, signal?: AbortSignal) {
    const dataUrl = await imageToDataUrl(reference);
    const file = dataUrlToFile({ ...reference, dataUrl });
    return uploadBlob(file, signal);
}

async function uploadBlob(file: Blob, signal?: AbortSignal) {
    const presigned = await backendRequest<{ uploadId: string; url: string; method: "PUT"; headers: Record<string, string> }>("/uploads/presign", {
        method: "POST",
        signal,
        body: { mimeType: file.type, size: file.size },
    });
    let response: Response;
    try {
        response = await fetch(presigned.url, { method: presigned.method, headers: presigned.headers, body: file, signal });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BackendError("UPLOAD_FAILED");
    }
    if (!response.ok) throw new BackendError("UPLOAD_FAILED");
    await backendRequest(`/uploads/${presigned.uploadId}/complete`, { method: "POST", signal });
    return presigned.uploadId;
}

async function waitForJob(initial: GenerationJob, signal?: AbortSignal): Promise<GenerationJob> {
    let job = initial;
    try {
        while (job.status === "queued" || job.status === "running") {
            await wait(POLL_INTERVAL_MS, signal);
            job = await fetchCloudGeneration(job.id, signal);
        }
    } catch (error) {
        if (signal?.aborted) void backendRequest(`/generations/${job.id}/cancel`, { method: "POST" }).catch(() => undefined);
        throw error;
    }
    if (job.status === "failed") throw new BackendError(job.errorCode || "PROVIDER_ERROR");
    if (job.status === "cancelled") throw abortError();
    return job;
}

function wait(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(abortError());
        };
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function abortError() {
    return new DOMException("Aborted", "AbortError");
}

function mimeTypeOf(dataUrl: string) {
    return dataUrl.match(/^data:([^;,]+)/)?.[1] || "image/png";
}
