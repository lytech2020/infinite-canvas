import { backendRequest } from "./backend";

let sessionVersion = 0;

export function reportCloudSaveError(error?: unknown) {
    window.dispatchEvent(new CustomEvent("cloud-save-error", { detail: { message: error instanceof Error ? error.message : "" } }));
}

export function resetCloudUserDataSession() {
    sessionVersion += 1;
}

function assertSession(version: number) {
    if (version !== sessionVersion) throw new DOMException("账号已切换", "AbortError");
}

export async function readUserData<T>(key: string): Promise<T | null> {
    const version = sessionVersion;
    const value = (await backendRequest<{ value: T | null }>(`/user-data/${encodeKey(key)}`)).value;
    assertSession(version);
    return value;
}

export async function writeUserData(key: string, value: unknown) {
    const version = sessionVersion;
    assertSession(version);
    await backendRequest(`/user-data/${encodeKey(key)}`, { method: "PUT", body: { value } });
    assertSession(version);
}

export async function removeUserData(key: string) {
    const version = sessionVersion;
    assertSession(version);
    await backendRequest(`/user-data/${encodeKey(key)}`, { method: "DELETE" });
    assertSession(version);
}

export function encodeKey(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 兼容页面现有日志接口；服务端原子维护索引与条目，并批量返回历史。 */
export function createCloudCollectionStore<T extends { id: string }>(key: string) {
    let mutation = Promise.resolve();
    const collectionPath = `/user-data/collections/${encodeKey(key)}`;
    const run = (operation: () => Promise<void>) => {
        const version = sessionVersion;
        const next = mutation.then(async () => {
            assertSession(version);
            await operation();
        });
        mutation = next.catch(() => undefined);
        return next.catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            reportCloudSaveError(error);
        });
    };
    return {
        setItem: (id: string, value: T) => run(async () => { await backendRequest(collectionPath, { method: "PUT", body: { id, value } }); }),
        removeItem: (id: string) => run(async () => { await backendRequest(`${collectionPath}/${encodeURIComponent(id)}`, { method: "DELETE" }); }),
        clear: () => run(async () => { await backendRequest(collectionPath, { method: "DELETE" }); }),
        iterate: async <Value = T, R = void>(_callback: (value: Value, key: string) => R) => {
            const version = sessionVersion;
            await mutation;
            assertSession(version);
            const { items } = await backendRequest<{ items: Array<{ id: string; value: T }> }>(collectionPath);
            assertSession(version);
            items.forEach((item) => _callback(item.value as unknown as Value, item.id));
        },
    };
}

export function createCloudKeyValueStore(namespace: string) {
    const cloudKey = (key: string) => `${namespace}:${key}`;
    return {
        getItem: <T>(key: string) => readUserData<T>(cloudKey(key)),
        setItem: (key: string, value: unknown) => writeUserData(cloudKey(key), value ?? null),
        removeItem: (key: string) => removeUserData(cloudKey(key)),
    };
}
