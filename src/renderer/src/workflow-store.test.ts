import { beforeEach, expect, it } from "vitest";
import { getNodeType } from "@shared/node-registry";
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
