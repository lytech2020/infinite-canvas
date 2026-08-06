import { backendRequest } from "./backend";
import { useUserStore } from "@/stores/use-user-store";

export type CloudProject = { id: string; name: string; createdAt: string; updatedAt: string; deletedAt: string | null };

/**
 * 未登录时画布仍可本地使用，此时跳过登记，不打断任何本地操作。
 * 刷新后画布可能早于会话恢复完成，这里先等一次恢复，避免误判为未登录而漏登记。
 */
async function signedIn() {
    const state = useUserStore.getState();
    if (!state.restored) await state.restoreSession();
    return Boolean(useUserStore.getState().user);
}

/** 登记或确认画布项目；同一 ID 幂等，创建、导入和打开画布都调用它。 */
export async function registerProject(id: string, name: string) {
    if (!(await signedIn())) return;
    await backendRequest<{ project: CloudProject }>("/projects", { method: "POST", body: { id, name } });
}

/** 重命名画布时同步后台项目名称。 */
export async function renameCloudProject(id: string, name: string) {
    if (!(await signedIn())) return;
    await backendRequest<{ project: CloudProject }>(`/projects/${id}`, { method: "PATCH", body: { name } });
}

/** 删除画布时软删除后台项目，历史用量和名称快照保留。 */
export async function deleteCloudProject(id: string) {
    if (!(await signedIn())) return;
    await backendRequest<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" });
}
