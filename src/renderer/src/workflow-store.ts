import { create } from "zustand";
import { getNodeType } from "@shared/node-registry";
import { connectError, type WorkflowConnection } from "@shared/validate-workflow";
import type { Position, Viewport, Workflow, WorkflowNode } from "@shared/workflow";

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
  connect: (connection: WorkflowConnection) => void;
  moveNode: (id: string, position: Position) => void;
  selectNode: (id: string | null) => void;
  setViewport: (viewport: Viewport) => void;
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
    const node: WorkflowNode = {
      id: nextId(type, workflow.nodes.map((item) => item.id)),
      type,
      position,
      data: {
        label: nextLabel(
          definition.label,
          workflow.nodes.map((item) => item.data.label),
        ),
      },
    };

    set({
      workflow: { ...workflow, nodes: [...workflow.nodes, node] },
      selectedNodeId: node.id,
      connectionError: null,
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
  setViewport: (viewport) => {
    const workflow = get().workflow;
    set({ workflow: { ...workflow, viewport } });
  },
}));
