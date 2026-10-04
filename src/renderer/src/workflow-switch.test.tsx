import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useRunStore } from "./run-store";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { useWorkflowStore } from "./workflow-store";

beforeEach(() => {
  useWorkflowStore.setState(useWorkflowStore.getInitialState(), true);
  useRunStore.setState(useRunStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});

it("shows a newly dropped agent as idle in a new workflow", () => {
  useWorkflowStore.getState().addNode("agent", { x: 0, y: 0 });
  const previous = useWorkflowStore.getState().workflow.nodes[0];
  if (!previous) {
    throw new Error("expected an agent");
  }
  useRunStore.setState({
    statusByNode: { [previous.id]: "completed" },
    logsByNode: { [previous.id]: "I need to create a file named left.txt" },
    log: "I need to create a file named left.txt",
    workspacePath: "C:\\prod\\scratch-repo",
  });

  useWorkflowStore.getState().replaceWorkflow({
    id: "fresh",
    name: "Fresh",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  });
  useWorkflowStore.getState().addNode("agent", { x: 40, y: 40 });

  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas />
    </div>,
  );

  expect(screen.getByTestId("node-status")).toHaveTextContent("idle");
  expect(useRunStore.getState().log).toBe("");
  expect(useRunStore.getState().workspacePath).toBeNull();
  expect(useRunStore.getState().logsByNode).toEqual({});
});
