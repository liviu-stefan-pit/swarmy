import { create } from "zustand";
import type { ApprovalDecision, NodeRunStatus, PendingApproval, RunUpdate } from "@shared/runs";
import { useWorkflowStore } from "./workflow-store";

type RunState = {
  statusByNode: Record<string, NodeRunStatus>;
  logsByNode: Record<string, string>;
  log: string;
  workspacePath: string | null;
  activeNodeId: string | null;
  workflowRunning: boolean;
  unfinishedThreadId: string | null;
  approvals: PendingApproval[];
  start: (nodeId: string) => Promise<void>;
  startWorkflow: () => Promise<void>;
  resume: () => Promise<void>;
  refreshUnfinished: (workflowId: string) => Promise<void>;
  decide: (decision: ApprovalDecision) => Promise<void>;
  cancel: (nodeId?: string) => Promise<void>;
  cancelWorkflow: () => Promise<void>;
  steer: (nodeId: string, text: string) => Promise<void>;
};

export const useRunStore = create<RunState>((set, get) => ({
  statusByNode: {},
  logsByNode: {},
  log: "",
  workspacePath: null,
  activeNodeId: null,
  workflowRunning: false,
  unfinishedThreadId: null,
  approvals: [],
  async start(nodeId) {
    if (get().activeNodeId || get().workflowRunning) {
      return;
    }
    const workflow = useWorkflowStore.getState().workflow;
    const node = workflow.nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "agent") {
      return;
    }

    set({
      activeNodeId: nodeId,
      log: "",
      workspacePath: null,
      statusByNode: { ...get().statusByNode, [nodeId]: "running" },
    });

    const stop = window.swarmy.runs.onUpdate((update) => {
      applyUpdate(set, get, update);
    });

    try {
      const done = await window.swarmy.runs.start({
        nodeId,
        prompt: node.data.taskPrompt ?? "",
        ...(node.data.modelId ? { modelId: node.data.modelId } : {}),
        ...(node.data.systemPrompt !== undefined ? { systemPrompt: node.data.systemPrompt } : {}),
        ...(node.data.tools !== undefined ? { tools: node.data.tools } : {}),
        ...(node.data.disallowedTools !== undefined ? { disallowedTools: node.data.disallowedTools } : {}),
        ...(node.data.guardrails !== undefined ? { guardrails: node.data.guardrails } : {}),
        ...(node.data.writePaths !== undefined ? { writePaths: node.data.writePaths } : {}),
        ...(node.data.sandboxEnabled !== undefined ? { sandboxEnabled: node.data.sandboxEnabled } : {}),
        ...(node.data.autoReview !== undefined ? { autoReview: node.data.autoReview } : {}),
        ...(node.data.workspaceMode ? { workspaceMode: node.data.workspaceMode } : {}),
        ...(workflow.repositoryPath ? { repositoryPath: workflow.repositoryPath } : {}),
        ...(node.data.folderPath ? { folderPath: node.data.folderPath } : {}),
      });
      applyUpdate(set, get, done);
    } catch (error) {
      set({
        log: errorText(error),
        activeNodeId: get().activeNodeId === nodeId ? null : get().activeNodeId,
        statusByNode: { ...get().statusByNode, [nodeId]: "failed" },
      });
    } finally {
      stop();
      if (get().activeNodeId === nodeId) {
        set({ activeNodeId: null });
      }
    }
  },
  async startWorkflow() {
    if (get().activeNodeId || get().workflowRunning) {
      return;
    }
    const workflow = useWorkflowStore.getState().workflow;
    set({
      workflowRunning: true,
      log: "",
      workspacePath: null,
      logsByNode: {},
      approvals: [],
      statusByNode: Object.fromEntries(workflow.nodes.map((node) => [node.id, "queued" as const])),
    });

    const stop = window.swarmy.runs.onUpdate((update) => {
      applyUpdate(set, get, update);
    });

    try {
      const result = await window.swarmy.runs.startWorkflow(workflow);
      const statusByNode = { ...get().statusByNode };
      for (const [nodeId, status] of Object.entries(result.statuses)) {
        statusByNode[nodeId] = status;
      }
      set({ statusByNode });
    } catch (error) {
      set({ log: errorText(error) });
    } finally {
      stop();
      set({ workflowRunning: false });
      await get().refreshUnfinished(useWorkflowStore.getState().workflow.id);
    }
  },
  async resume() {
    const threadId = get().unfinishedThreadId;
    if (!threadId || get().activeNodeId || get().workflowRunning) {
      return;
    }
    const workflow = useWorkflowStore.getState().workflow;
    set({
      workflowRunning: true,
      unfinishedThreadId: null,
      log: "",
      workspacePath: null,
    });
    const stop = window.swarmy.runs.onUpdate((update) => {
      applyUpdate(set, get, update);
    });
    try {
      const result = await window.swarmy.runs.resume(workflow, threadId);
      const statusByNode = { ...get().statusByNode };
      for (const [nodeId, status] of Object.entries(result.statuses)) {
        statusByNode[nodeId] = status;
      }
      set({ statusByNode });
    } catch (error) {
      set({ log: errorText(error) });
    } finally {
      stop();
      set({ workflowRunning: false });
      await get().refreshUnfinished(workflow.id);
    }
  },
  async refreshUnfinished(workflowId) {
    if (get().workflowRunning) {
      return;
    }
    try {
      const threadId = await window.swarmy.runs.unfinished(workflowId);
      if (get().workflowRunning) {
        return;
      }
      if (!threadId) {
        set({ unfinishedThreadId: null, approvals: [] });
        return;
      }
      const workflow = useWorkflowStore.getState().workflow;
      const approvals = await window.swarmy.runs.pendingApprovals(workflow, threadId);
      if (get().workflowRunning) {
        return;
      }
      const statusByNode = { ...get().statusByNode };
      const logsByNode = { ...get().logsByNode };
      for (const item of approvals) {
        statusByNode[item.nodeId] = "waiting";
        logsByNode[item.nodeId] = item.summary;
      }
      set({ unfinishedThreadId: threadId, approvals, statusByNode, logsByNode });
    } catch {
      set({ unfinishedThreadId: null });
    }
  },
  async decide(decision) {
    const reason = decision.reason?.trim() ?? "";
    if (decision.action === "reject" && reason.length === 0) {
      return;
    }
    const payload: ApprovalDecision =
      decision.action === "reject"
        ? { nodeId: decision.nodeId, action: "reject", reason }
        : {
            nodeId: decision.nodeId,
            action: "approve",
            ...(decision.files && decision.files.length > 0 ? { files: decision.files } : {}),
          };
    set({ approvals: get().approvals.filter((item) => item.nodeId !== decision.nodeId) });
    if (get().workflowRunning) {
      try {
        await window.swarmy.runs.decide(payload);
      } catch (error) {
        set({ log: errorText(error) });
      }
      return;
    }

    const threadId = get().unfinishedThreadId;
    if (!threadId) {
      return;
    }
    const workflow = useWorkflowStore.getState().workflow;
    set({
      workflowRunning: true,
      unfinishedThreadId: null,
      log: "",
      workspacePath: null,
    });
    const stop = window.swarmy.runs.onUpdate((update) => {
      applyUpdate(set, get, update);
    });
    try {
      const result = await window.swarmy.runs.resume(workflow, threadId, payload);
      const statusByNode = { ...get().statusByNode };
      for (const [nodeId, status] of Object.entries(result.statuses)) {
        statusByNode[nodeId] = status;
      }
      set({ statusByNode, approvals: [] });
    } catch (error) {
      set({ log: errorText(error) });
    } finally {
      stop();
      set({ workflowRunning: false });
      await get().refreshUnfinished(workflow.id);
    }
  },
  async cancel(nodeId) {
    const target = nodeId ?? get().activeNodeId;
    if (!target) {
      return;
    }
    try {
      await window.swarmy.runs.cancel(target);
    } catch (error) {
      const current = get().log;
      const message = errorText(error);
      set({ log: current.length > 0 ? `${current}\n${message}` : message });
    }
  },
  async cancelWorkflow() {
    if (!get().workflowRunning) {
      return;
    }
    try {
      await window.swarmy.runs.cancelWorkflow();
    } catch (error) {
      const current = get().log;
      const message = errorText(error);
      set({ log: current.length > 0 ? `${current}\n${message}` : message });
    }
  },
  async steer(nodeId, text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    try {
      await window.swarmy.runs.steer(nodeId, trimmed);
    } catch (error) {
      const current = get().logsByNode[nodeId] ?? get().log;
      const message = errorText(error);
      const next = current.length > 0 ? `${current}\n${message}` : message;
      set({
        log: next,
        logsByNode: { ...get().logsByNode, [nodeId]: next },
      });
    }
  },
}));

function applyUpdate(
  set: (partial: Partial<RunState>) => void,
  get: () => RunState,
  update: RunUpdate,
): void {
  const approvals =
    update.status === "waiting"
      ? [
          ...get().approvals.filter((item) => item.nodeId !== update.nodeId),
          {
            nodeId: update.nodeId,
            summary: update.log,
            files: update.files ?? [],
            ...(update.workspacePath ? { workspacePath: update.workspacePath } : {}),
          },
        ]
      : get().approvals.filter((item) => item.nodeId !== update.nodeId);
  set({
    log: update.log,
    logsByNode: { ...get().logsByNode, [update.nodeId]: update.log },
    statusByNode: { ...get().statusByNode, [update.nodeId]: update.status },
    approvals,
    ...(update.workspacePath ? { workspacePath: update.workspacePath } : {}),
  });
}

function errorText(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "The run failed";
  const wrapped = message.match(/^Error invoking remote method '[^']+': Error: ([\s\S]*)$/);
  return wrapped?.[1] ?? message;
}
