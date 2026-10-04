import { beforeEach, expect, it } from "vitest";
import { getNodeType } from "@shared/node-registry";
import { workflowSchema } from "@shared/workflow";
import { useWorkflowStore } from "./workflow-store";

beforeEach(() => {
  useWorkflowStore.setState(useWorkflowStore.getInitialState(), true);
});

it("appends an agent node whose type is registered", () => {
  useWorkflowStore.getState().addNode("agent", { x: 16, y: 32 });

  const nodes = useWorkflowStore.getState().workflow.nodes;
  expect(nodes).toHaveLength(1);
  const added = nodes[0];
  expect(added?.type).toBe("agent");
  expect(getNodeType(added?.type ?? "")).toBeDefined();
});

it("leaves the edge list unchanged when a diff output is wired to a file input", () => {
  useWorkflowStore.getState().addNode("agent", { x: 0, y: 0 });
  useWorkflowStore.getState().addNode("agent", { x: 240, y: 0 });

  const [source, target] = useWorkflowStore.getState().workflow.nodes;
  if (!source || !target) {
    throw new Error("expected two agent nodes");
  }

  const edgesBefore = useWorkflowStore.getState().workflow.edges;
  useWorkflowStore.getState().connect({
    source: source.id,
    sourceHandle: "diff",
    target: target.id,
    targetHandle: "file",
  });

  expect(useWorkflowStore.getState().workflow.edges).toEqual(edgesBefore);
  expect(useWorkflowStore.getState().connectionError).toEqual(expect.any(String));
  expect(useWorkflowStore.getState().connectionError).toMatch(/diff/);
  expect(useWorkflowStore.getState().connectionError).toMatch(/file/);
});

it("removing a node drops it and every edge that used it", () => {
  useWorkflowStore.getState().addNode("textInput", { x: 0, y: 0 });
  useWorkflowStore.getState().addNode("agent", { x: 240, y: 0 });
  useWorkflowStore.getState().addNode("planner", { x: 480, y: 0 });

  const [text, agent, planner] = useWorkflowStore.getState().workflow.nodes;
  if (!text || !agent || !planner) {
    throw new Error("expected a text node, an agent, and a planner");
  }

  useWorkflowStore.getState().connect({
    source: text.id,
    sourceHandle: "text",
    target: agent.id,
    targetHandle: "text",
  });
  useWorkflowStore.getState().connect({
    source: agent.id,
    sourceHandle: "text",
    target: planner.id,
    targetHandle: "text",
  });
  useWorkflowStore.getState().selectNode(agent.id);

  const workflowId = useWorkflowStore.getState().workflow.id;
  useWorkflowStore.getState().removeNode(agent.id);

  const next = useWorkflowStore.getState();
  expect(next.workflow.id).toBe(workflowId);
  expect(next.workflow.nodes.map((node) => node.id)).toEqual([text.id, planner.id]);
  expect(next.workflow.edges).toEqual([]);
  expect(next.selectedNodeId).toBeNull();
});

it("editing the system prompt on the selected agent changes only that node", () => {
  useWorkflowStore.getState().addNode("agent", { x: 0, y: 0 });
  useWorkflowStore.getState().addNode("agent", { x: 240, y: 0 });

  const [first, second] = useWorkflowStore.getState().workflow.nodes;
  if (!first || !second) {
    throw new Error("expected two agent nodes");
  }

  const untouched = structuredClone(second);
  useWorkflowStore.getState().selectNode(first.id);
  useWorkflowStore.getState().updateSelectedNode({ systemPrompt: "Stay in the repo." });

  const nodes = useWorkflowStore.getState().workflow.nodes;
  const edited = nodes.find((node) => node.id === first.id);
  const other = nodes.find((node) => node.id === second.id);
  if (!edited || edited.type !== "agent") {
    throw new Error("expected the selected agent");
  }

  expect(edited.data.systemPrompt).toBe("Stay in the repo.");
  expect(edited.data.tools).toBeUndefined();
  expect(other).toEqual(untouched);
  expect(workflowSchema.parse(useWorkflowStore.getState().workflow).nodes).toHaveLength(2);
});
