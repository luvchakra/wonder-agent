"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { actOnFulfilmentTask, reassignFulfilmentTask } from "@/modules/access-governance/service";

/** ACCESS-P0-29 — claim, complete or fail a fulfilment task. The service decides who may; the outcome shown is the server's (§17.5). */
export type TaskFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

export async function fulfilmentTaskAction(taskId: string, _prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const ctx = await requirePermission("access.read");
  const action = formData.get("action");
  const note = formData.get("note");
  try {
    const task = await actOnFulfilmentTask(ctx.tenantId!, { userId: ctx.userId, canApprove: ctx.permissions.includes("access.approve") }, taskId, action, note);
    revalidatePath("/access/fulfilment");
    revalidatePath("/access/requests");
    if (action === "retry_connector") {
      return task.connectorStatus === "succeeded"
        ? { status: "saved", message: "The connector made the change. It is verified when the next sync finds it on the target." }
        : { status: "error", message: `The connector could not make the change: ${task.connectorError ?? "no reason given"}` };
    }
    return { status: "saved", message: action === "claim" ? "Claimed: it is yours to do." : action === "complete" ? "Done. It is verified when the next sync finds it on the target." : "Recorded as failed." };
  } catch (err) {
    const e = err as { message?: string; code?: string };
    return { status: "error", message: e?.message || e?.code || "Something went wrong" };
  }
}

/** ACCESS-P0-42 — hand a task to another person or group (`assignee` is `identity:<id>` or `group:<id>`), with a reason. */
export async function reassignTaskAction(taskId: string, _prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const ctx = await requirePermission("access.read");
  const [kind, id] = String(formData.get("assignee") ?? "").split(":");
  try {
    await reassignFulfilmentTask(ctx.tenantId!, { userId: ctx.userId, canApprove: ctx.permissions.includes("access.approve") }, taskId, {
      identityId: kind === "identity" ? id : undefined,
      groupId: kind === "group" ? id : undefined,
      reason: formData.get("reason"),
    });
    revalidatePath("/access/fulfilment");
    revalidatePath("/access/requests");
    return { status: "saved", message: "Reassigned. The new assignee has been told." };
  } catch (err) {
    const e = err as { message?: string; code?: string };
    return { status: "error", message: e?.message || e?.code || "Something went wrong" };
  }
}
