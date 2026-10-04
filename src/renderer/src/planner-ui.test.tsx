import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NodeInspector } from "./NodeInspector";
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

it("shows spawned workers under the planner and keeps them out of the saved workflow", () => {
  useWorkflowStore.getState().addNode("planner", { x: 0, y: 0 });
  const planner = useWorkflowStore.getState().workflow.nodes[0];
  if (!planner) {
    throw new Error("expected a planner");
  }
  useRunStore.setState({
    plannerWorkers: [
      { plannerId: planner.id, taskId: "one", title: "First file", status: "running" },
      {
        plannerId: planner.id,
        taskId: "two",
        title: "Second file",
        status: "completed",
        workspacePath: "C:\\managed\\two",
      },
    ],
  });

  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas />
    </div>,
  );

  const rows = screen.getAllByTestId("planner-worker");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("First file");
  expect(rows[0]).toHaveTextContent("running");
  expect(rows[1]).toHaveTextContent("Second file");
  expect(rows[1]).toHaveTextContent("completed");
  expect(rows[1]).not.toHaveTextContent("C:\\managed\\two");
  expect(rows[1]).toHaveAttribute("title", "C:\\managed\\two");
  expect(useWorkflowStore.getState().workflow.nodes).toHaveLength(1);
  expect(useWorkflowStore.getState().workflow.nodes[0]?.type).toBe("planner");
});

it("saves the planner goal and workspace mode", () => {
  useWorkflowStore.getState().addNode("planner", { x: 0, y: 0 });
  render(<NodeInspector />);

  fireEvent.change(screen.getByTestId("inspector-goal"), { target: { value: "List two files" } });
  fireEvent.change(screen.getByTestId("inspector-workspace-mode"), { target: { value: "managed" } });

  const planner = useWorkflowStore.getState().workflow.nodes[0];
  if (!planner || planner.type !== "planner") {
    throw new Error("expected a planner");
  }
  expect(planner.data.taskPrompt).toBe("List two files");
  expect(planner.data.workspaceMode).toBe("managed");
});
