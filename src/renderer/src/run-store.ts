import { create } from "zustand";
import type { NodeRunStatus, RunUpdate } from "@shared/runs";
import { useWorkflowStore } from "./workflow-store";

type RunState = {
  statusByNode: Record<string, NodeRunStatus>;
  log: string;
  workspacePath: string | null;
  activeNodeId: string | null;
  start: (nodeId: string) => Promise<void>;
  cancel: () => Promise<void>;
};

export const useRunStore = create<RunState>((set, get) => ({
  statusByNode: {},
  log: "",
  workspacePath: null,
  activeNodeId: null,
  async start(nodeId) {
    if (get().activeNodeId) {
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
  async cancel() {
    const nodeId = get().activeNodeId;
    if (!nodeId) {
      return;
    }
    try {
      await window.swarmy.runs.cancel(nodeId);
    } catch (error) {
      const current = get().log;
      const message = errorText(error);
      set({ log: current.length > 0 ? `${current}\n${message}` : message });
    }
  },
}));

function applyUpdate(
  set: (partial: Partial<RunState>) => void,
  get: () => RunState,
  update: RunUpdate,
): void {
  set({
    log: update.log,
    statusByNode: { ...get().statusByNode, [update.nodeId]: update.status },
    ...(update.workspacePath ? { workspacePath: update.workspacePath } : {}),
  });
}

function errorText(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "The run failed";
  const wrapped = message.match(/^Error invoking remote method '[^']+': Error: ([\s\S]*)$/);
  return wrapped?.[1] ?? message;
}
