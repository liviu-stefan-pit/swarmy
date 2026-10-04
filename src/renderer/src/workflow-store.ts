import { create } from "zustand";
import { getNodeType } from "@shared/node-registry";
import { connectError, type WorkflowConnection } from "@shared/validate-workflow";
import {
  agentNodeDataSchema,
  fileInputDataSchema,
  folderInputDataSchema,
  mcpNodeDataSchema,
  mergeNodeDataSchema,
  plannerNodeDataSchema,
  textInputDataSchema,
  workflowNodeSchema,
  workflowSchema,
  type AgentNodeData,
  type McpTransport,
  type PlannerNodeData,
  type Position,
  type Viewport,
  type Trigger,
  type Workflow,
  type WorkflowNode,
} from "@shared/workflow";

const emptyWorkflow: Workflow = {
  id: "untitled",
  name: "Untitled",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
};

type WorkflowState = {
  workflow: Workflow;
  selectedNodeId: string | null;
  connectionError: string | null;
  addNode: (type: string, position: Position) => void;
  removeNode: (id: string) => void;
  connect: (connection: WorkflowConnection) => void;
  moveNode: (id: string, position: Position) => void;
  selectNode: (id: string | null) => void;
  updateNode: (id: string, patch: NodePatch) => void;
  updateSelectedNode: (patch: NodePatch) => void;
  setViewport: (viewport: Viewport) => void;
  replaceWorkflow: (workflow: Workflow) => void;
  renameWorkflow: (name: string) => void;
  setRepositoryPath: (path: string) => void;
  setBudget: (tokens: number | null) => void;
  setRequiredEnvVars: (names: string[]) => void;
  setTrigger: (trigger: Trigger | null) => void;
};

function nextId(prefix: string, ids: readonly string[]): string {
  const taken = new Set(ids);
  let n = taken.size + 1;
  let id = `${prefix}-${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  return id;
}

function nextLabel(base: string, labels: readonly string[]): string {
  const taken = new Set(labels);
  if (!taken.has(base)) return base;
  let n = 2;
  let label = `${base} ${n}`;
  while (taken.has(label)) {
    n += 1;
    label = `${base} ${n}`;
  }
  return label;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflow: emptyWorkflow,
  selectedNodeId: null,
  connectionError: null,
  addNode: (type, position) => {
    const definition = getNodeType(type);
    if (!definition) return;

    const workflow = get().workflow;
    const node = workflowNodeSchema.parse({
      id: nextId(type, workflow.nodes.map((item) => item.id)),
      type: definition.type,
      position,
      data: {
        label: nextLabel(
          definition.label,
          workflow.nodes.map((item) => item.data.label),
        ),
      },
    });

    set({
      workflow: { ...workflow, nodes: [...workflow.nodes, node] },
      selectedNodeId: node.id,
      connectionError: null,
    });
  },
  removeNode: (id) => {
    const { workflow, selectedNodeId } = get();
    if (!workflow.nodes.some((node) => node.id === id)) {
      return;
    }
    set({
      workflow: {
        ...workflow,
        nodes: workflow.nodes.filter((node) => node.id !== id),
        edges: workflow.edges.filter((edge) => edge.source !== id && edge.target !== id),
      },
      selectedNodeId: selectedNodeId === id ? null : selectedNodeId,
    });
  },
  connect: (connection) => {
    const workflow = get().workflow;
    const error = connectError(workflow, connection);
    if (error) {
      set({ connectionError: error });
      return;
    }

    set({
      connectionError: null,
      workflow: {
        ...workflow,
        edges: [
          ...workflow.edges,
          { id: nextId("edge", workflow.edges.map((edge) => edge.id)), ...connection },
        ],
      },
    });
  },
  moveNode: (id, position) => {
    const workflow = get().workflow;
    set({
      workflow: {
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.id === id ? { ...node, position: { x: position.x, y: position.y } } : node,
        ),
      },
    });
  },
  selectNode: (id) => {
    set({ selectedNodeId: id });
  },
  updateNode: (id, patch) => {
    const workflow = get().workflow;
    const current = workflow.nodes.find((node) => node.id === id);
    if (!current) return;

    const nextNode = withNodePatch(current, patch);
    const parsed = workflowSchema.safeParse({
      ...workflow,
      nodes: workflow.nodes.map((node) => (node.id === current.id ? nextNode : node)),
    });
    if (!parsed.success) return;

    set({ workflow: parsed.data });
  },
  updateSelectedNode: (patch) => {
    const selectedNodeId = get().selectedNodeId;
    if (!selectedNodeId) return;
    get().updateNode(selectedNodeId, patch);
  },
  setViewport: (viewport) => {
    const workflow = get().workflow;
    set({ workflow: { ...workflow, viewport } });
  },
  replaceWorkflow: (workflow) => {
    const parsed = workflowSchema.parse(workflow);
    set({ workflow: parsed, selectedNodeId: null, connectionError: null });
  },
  renameWorkflow: (name) => {
    const workflow = get().workflow;
    const parsed = workflowSchema.safeParse({ ...workflow, name });
    if (!parsed.success) {
      return;
    }
    set({ workflow: parsed.data });
  },
  setRepositoryPath: (path) => {
    const workflow = get().workflow;
    const repositoryPath = path.trim();
    const next = { ...workflow };
    if (repositoryPath.length > 0) {
      next.repositoryPath = repositoryPath;
    } else {
      delete next.repositoryPath;
    }
    const parsed = workflowSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    set({ workflow: parsed.data });
  },
  setBudget: (tokens) => {
    const workflow = get().workflow;
    const next = { ...workflow };
    if (tokens === null) {
      delete next.budgetTokens;
    } else {
      next.budgetTokens = tokens;
    }
    const parsed = workflowSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    set({ workflow: parsed.data });
  },
  setRequiredEnvVars: (names) => {
    const workflow = get().workflow;
    const next = { ...workflow };
    if (names.length === 0) {
      delete next.requiredEnvVars;
    } else {
      next.requiredEnvVars = names;
    }
    const parsed = workflowSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    set({ workflow: parsed.data });
  },
  setTrigger: (trigger) => {
    const workflow = get().workflow;
    const next = { ...workflow };
    if (trigger === null || trigger.mode === "manual") {
      delete next.trigger;
    } else {
      next.trigger = trigger;
    }
    const parsed = workflowSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    set({ workflow: parsed.data });
  },
}));

export type NodePatch = Partial<AgentNodeData> & {
  targetBranch?: string;
  text?: string;
  sourcePath?: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headerSecretId?: string;
};

function withNodePatch(node: WorkflowNode, patch: NodePatch): WorkflowNode {
  if (node.type === "merge") {
    const label = patch.label ?? node.data.label;
    const targetBranch = Object.hasOwn(patch, "targetBranch") ? patch.targetBranch : node.data.targetBranch;
    return {
      ...node,
      data: mergeNodeDataSchema.parse({
        label,
        ...(targetBranch ? { targetBranch } : {}),
      }),
    };
  }

  if (node.type === "planner") {
    const next: PlannerNodeData = { label: patch.label ?? node.data.label };
    const modelId = Object.hasOwn(patch, "modelId") ? patch.modelId : node.data.modelId;
    if (modelId !== undefined) next.modelId = modelId;
    const systemPrompt = Object.hasOwn(patch, "systemPrompt") ? patch.systemPrompt : node.data.systemPrompt;
    if (systemPrompt !== undefined) next.systemPrompt = systemPrompt;
    const taskPrompt = Object.hasOwn(patch, "taskPrompt") ? patch.taskPrompt : node.data.taskPrompt;
    if (taskPrompt !== undefined) next.taskPrompt = taskPrompt;
    const workspaceMode = Object.hasOwn(patch, "workspaceMode") ? patch.workspaceMode : node.data.workspaceMode;
    if (workspaceMode !== undefined) next.workspaceMode = workspaceMode;
    const folderPath = Object.hasOwn(patch, "folderPath") ? patch.folderPath : node.data.folderPath;
    if (folderPath) next.folderPath = folderPath;
    return { ...node, data: plannerNodeDataSchema.parse(next) };
  }

  if (node.type === "textInput") {
    const text = Object.hasOwn(patch, "text") ? patch.text : node.data.text;
    return {
      ...node,
      data: textInputDataSchema.parse({
        label: patch.label ?? node.data.label,
        ...(text !== undefined ? { text } : {}),
      }),
    };
  }

  if (node.type === "fileInput") {
    const sourcePath = Object.hasOwn(patch, "sourcePath") ? patch.sourcePath : node.data.sourcePath;
    return {
      ...node,
      data: fileInputDataSchema.parse({
        label: patch.label ?? node.data.label,
        ...(sourcePath ? { sourcePath } : {}),
      }),
    };
  }

  if (node.type === "folderInput") {
    const folderPath = Object.hasOwn(patch, "folderPath") ? patch.folderPath : node.data.folderPath;
    return {
      ...node,
      data: folderInputDataSchema.parse({
        label: patch.label ?? node.data.label,
        ...(folderPath ? { folderPath } : {}),
      }),
    };
  }

  if (node.type === "mcp") {
    return { ...node, data: mcpData(node.data, patch) };
  }

  if (node.type !== "agent") {
    return { ...node, data: { label: patch.label ?? node.data.label } };
  }

  const next: AgentNodeData = { label: patch.label ?? node.data.label };
  const modelId = Object.hasOwn(patch, "modelId") ? patch.modelId : node.data.modelId;
  if (modelId !== undefined) next.modelId = modelId;
  const systemPrompt = Object.hasOwn(patch, "systemPrompt") ? patch.systemPrompt : node.data.systemPrompt;
  if (systemPrompt !== undefined) next.systemPrompt = systemPrompt;
  const taskPrompt = Object.hasOwn(patch, "taskPrompt") ? patch.taskPrompt : node.data.taskPrompt;
  if (taskPrompt !== undefined) next.taskPrompt = taskPrompt;
  const tools = Object.hasOwn(patch, "tools") ? patch.tools : node.data.tools;
  if (tools !== undefined) next.tools = tools;
  const disallowedTools = Object.hasOwn(patch, "disallowedTools")
    ? patch.disallowedTools
    : node.data.disallowedTools;
  if (disallowedTools !== undefined) next.disallowedTools = disallowedTools;
  const guardrails = Object.hasOwn(patch, "guardrails") ? patch.guardrails : node.data.guardrails;
  if (guardrails !== undefined) next.guardrails = guardrails;
  const writePaths = Object.hasOwn(patch, "writePaths") ? patch.writePaths : node.data.writePaths;
  if (writePaths !== undefined) next.writePaths = writePaths;
  const sandboxEnabled = Object.hasOwn(patch, "sandboxEnabled")
    ? patch.sandboxEnabled
    : node.data.sandboxEnabled;
  if (sandboxEnabled !== undefined) next.sandboxEnabled = sandboxEnabled;
  const autoReview = Object.hasOwn(patch, "autoReview") ? patch.autoReview : node.data.autoReview;
  if (autoReview !== undefined) next.autoReview = autoReview;
  const workspaceMode = Object.hasOwn(patch, "workspaceMode")
    ? patch.workspaceMode
    : node.data.workspaceMode;
  if (workspaceMode !== undefined) next.workspaceMode = workspaceMode;
  const folderPath = Object.hasOwn(patch, "folderPath") ? patch.folderPath : node.data.folderPath;
  if (folderPath) next.folderPath = folderPath;

  return { ...node, data: agentNodeDataSchema.parse(next) };
}

function mcpData(
  data: Extract<WorkflowNode, { type: "mcp" }>["data"],
  patch: NodePatch,
): Extract<WorkflowNode, { type: "mcp" }>["data"] {
  const transport = Object.hasOwn(patch, "transport") ? patch.transport : data.transport;
  const command = Object.hasOwn(patch, "command") ? patch.command : data.command;
  const args = Object.hasOwn(patch, "args") ? patch.args : data.args;
  const url = Object.hasOwn(patch, "url") ? patch.url : data.url;
  const headerSecretId = Object.hasOwn(patch, "headerSecretId") ? patch.headerSecretId : data.headerSecretId;
  return mcpNodeDataSchema.parse({
    label: patch.label ?? data.label,
    ...(transport ? { transport } : {}),
    ...(command ? { command } : {}),
    ...(args && args.length > 0 ? { args } : {}),
    ...(url ? { url } : {}),
    ...(headerSecretId ? { headerSecretId } : {}),
  });
}
