import { upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import type { AgentAttachment, AgentChatItem } from "@/stores/use-agent-store";
import { createCloudKeyValueStore } from "@/services/api/user-data";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";

export type StoredAgentUserMessage = Pick<AgentChatItem, "id" | "text" | "attachments"> & { role: "user"; historyText: string; threadId?: string; turnId?: string };

const store = createCloudKeyValueStore("agent_chat");
const mutations = new Map<string, Promise<void>>();
let mutationVersion = 0;

export function resetAgentChatStorage() {
    mutationVersion += 1;
    mutations.clear();
}
const indexKey = (threadId: string) => `thread:${threadId}`;
const messageKey = (threadId: string, messageId: string) => `message:${threadId}:${messageId}`;
const pendingKey = (messageId: string) => `pending:${messageId}`;
const threadMutationKey = (threadId: string) => `thread:${threadId}`;
const pendingMutationKey = (messageId: string) => `pending:${messageId}`;

export async function saveAgentUserMessage(threadId: string, message: StoredAgentUserMessage) {
    if (!message.attachments?.length) return;
    if (!threadId) return savePendingAgentUserMessage(message);
    await saveThreadAgentUserMessage(threadId, message);
}

/** Persist attachments before a turn is accepted. The record is moved to a thread after the server assigns one. */
export async function savePendingAgentUserMessage(message: StoredAgentUserMessage) {
    if (!message.id || !message.attachments?.length) return;
    await mutateScopes([pendingMutationKey(message.id)], async () => {
        const attachments = await createThumbnails(message.attachments!);
        try {
            await store.setItem(pendingKey(message.id), { ...message, threadId: undefined, turnId: undefined, attachments });
        } catch (error) {
            await deleteStoredImages(attachments.map((item) => item.storageKey).filter((key): key is string => Boolean(key)));
            throw error;
        }
    });
}

export async function deletePendingAgentUserMessage(messageId: string) {
    if (!messageId) return;
    await mutateScopes([pendingMutationKey(messageId)], async () => {
        const message = await store.getItem<StoredAgentUserMessage>(pendingKey(messageId));
        await store.removeItem(pendingKey(messageId));
        await deleteStoredImages((message?.attachments || []).map((item) => item.storageKey).filter((key): key is string => Boolean(key)));
    });
}

export async function readAgentUserMessages(threadId: string) {
    await mutations.get(threadMutationKey(threadId))?.catch(() => undefined);
    const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
    const messages = (await Promise.all(ids.map((id) => store.getItem<StoredAgentUserMessage>(messageKey(threadId, id))))).filter((item): item is StoredAgentUserMessage => Boolean(item));
    return Promise.all(messages.map(hydrateMessage));
}

/** Bind a pending message to the server thread, preserving an already-known turn id. */
export async function bindPendingAgentUserMessage(threadId: string, messageId: string, turnId = "") {
    if (!threadId || !messageId) return;
    await mutateScopes([pendingMutationKey(messageId), threadMutationKey(threadId)], async () => {
        const pending = await store.getItem<StoredAgentUserMessage>(pendingKey(messageId));
        const key = messageKey(threadId, messageId);
        const existing = await store.getItem<StoredAgentUserMessage>(key);
        if (!pending && !existing) return;
        const message = mergeStoredMessage(existing, pending, threadId, turnId);
        await putThreadMessage(threadId, key, message);
        if (pending) await store.removeItem(pendingKey(messageId));
    });
}

export async function bindAgentUserMessageTurn(threadId: string, messageId: string, turnId: string) {
    await bindPendingAgentUserMessage(threadId, messageId, turnId);
}

export async function moveAgentUserMessage(fromThreadId: string, toThreadId: string, messageId: string) {
    if (!toThreadId || !messageId || fromThreadId === toThreadId) return bindPendingAgentUserMessage(toThreadId, messageId);
    const scopes = [pendingMutationKey(messageId), threadMutationKey(toThreadId), ...(fromThreadId ? [threadMutationKey(fromThreadId)] : [])];
    await mutateScopes(scopes, async () => {
        const pending = await store.getItem<StoredAgentUserMessage>(pendingKey(messageId));
        const fromKey = fromThreadId ? messageKey(fromThreadId, messageId) : "";
        const from = fromKey ? await store.getItem<StoredAgentUserMessage>(fromKey) : null;
        const toKey = messageKey(toThreadId, messageId);
        const existing = await store.getItem<StoredAgentUserMessage>(toKey);
        const source = pending || from;
        if (!source && !existing) return;
        await putThreadMessage(toThreadId, toKey, mergeStoredMessage(existing, source, toThreadId));
        if (pending) await store.removeItem(pendingKey(messageId));
        if (from && fromThreadId) await removeThreadMessage(fromThreadId, fromKey, messageId);
    });
}

export async function deleteAgentThreadMessages(threadIds: string[]) {
    await mutateScopes(threadIds.map(threadMutationKey), async () => {
        await Promise.all(threadIds.map(async (threadId) => {
            const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
            const messages = await Promise.all(ids.map((id) => store.getItem<StoredAgentUserMessage>(messageKey(threadId, id))));
            await Promise.all(ids.map((id) => store.removeItem(messageKey(threadId, id))));
            await store.removeItem(indexKey(threadId));
            await deleteStoredImages(messages.flatMap((message) => (message?.attachments || []).map((item) => item.storageKey).filter((key): key is string => Boolean(key))));
        }));
    });
}

async function saveThreadAgentUserMessage(threadId: string, message: StoredAgentUserMessage) {
    await mutateScopes([threadMutationKey(threadId)], async () => {
        const attachments = await createThumbnails(message.attachments!);
        try {
            await putThreadMessage(threadId, messageKey(threadId, message.id), { ...message, threadId, attachments });
        } catch (error) {
            await deleteStoredImages(attachments.map((item) => item.storageKey).filter((key): key is string => Boolean(key)));
            throw error;
        }
    });
}

async function putThreadMessage(threadId: string, key: string, message: StoredAgentUserMessage) {
    await store.setItem(key, { ...message, threadId });
    const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
    if (!ids.includes(message.id)) await store.setItem(indexKey(threadId), [...ids, message.id]);
}

function mergeStoredMessage(existing: StoredAgentUserMessage | null, source: StoredAgentUserMessage | null | undefined, threadId: string, turnId = "") {
    const message = { ...(source || {}), ...(existing || {}) } as StoredAgentUserMessage;
    if (!message.attachments?.length && source?.attachments?.length) message.attachments = source.attachments;
    if (!message.text && source?.text) message.text = source.text;
    if (!message.historyText && source?.historyText) message.historyText = source.historyText;
    return { ...message, threadId, ...(turnId ? { turnId } : message.turnId ? { turnId: message.turnId } : {}) };
}

async function removeThreadMessage(threadId: string, key: string, messageId: string) {
    await store.removeItem(key);
    const ids = (await store.getItem<string[]>(indexKey(threadId))) || [];
    const remaining = ids.filter((id) => id !== messageId);
    if (remaining.length) await store.setItem(indexKey(threadId), remaining);
    else await store.removeItem(indexKey(threadId));
}

async function mutateScopes(scopes: string[], mutation: () => Promise<void>) {
    const version = mutationVersion;
    const ids = [...new Set(scopes.filter(Boolean))].sort();
    const operation = Promise.all(ids.map((id) => mutations.get(id)?.catch(() => undefined))).then(() => {
        if (version !== mutationVersion) throw new DOMException("账号已切换", "AbortError");
        return mutation();
    });
    ids.forEach((id) => mutations.set(id, operation));
    try {
        await operation;
    } finally {
        ids.forEach((id) => {
            if (mutations.get(id) === operation) mutations.delete(id);
        });
    }
}

async function createThumbnail(attachment: AgentAttachment): Promise<AgentAttachment> {
    const dataUrl = Math.max(attachment.width, attachment.height) > 512 ? await upscaleDataUrl(attachment.dataUrl, { targetLongEdge: 512, algorithm: "high" }) : attachment.dataUrl;
    const stored = await uploadImage(dataUrl);
    return { ...attachment, size: stored.bytes, type: stored.mimeType, url: "", dataUrl: "", storageKey: stored.storageKey };
}

async function createThumbnails(attachments: AgentAttachment[]) {
    const stored: AgentAttachment[] = [];
    try {
        for (const attachment of attachments) stored.push(await createThumbnail(attachment));
        return stored;
    } catch (error) {
        await deleteStoredImages(stored.map((item) => item.storageKey).filter((key): key is string => Boolean(key)));
        throw error;
    }
}

async function hydrateMessage(message: StoredAgentUserMessage) {
    if (!message.attachments?.length) return message;
    return { ...message, attachments: await Promise.all(message.attachments.map(async (attachment) => {
        if (!attachment.storageKey) return attachment;
        const url = await resolveImageUrl(attachment.storageKey, attachment.dataUrl || attachment.url);
        return { ...attachment, url, dataUrl: url };
    })) };
}
