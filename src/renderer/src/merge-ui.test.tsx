import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NodeInspector } from "./NodeInspector";
import { useWorkflowStore } from "./workflow-store";

beforeEach(() => {
  useWorkflowStore.setState(useWorkflowStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});

it("saves the merge target branch and shows main when it was omitted", () => {
  useWorkflowStore.getState().addNode("merge", { x: 0, y: 0 });
  render(<NodeInspector />);

  const input = screen.getByTestId("inspector-target-branch");
  expect(input).toHaveValue("main");
  fireEvent.change(input, { target: { value: "release" } });

  const node = useWorkflowStore.getState().workflow.nodes[0];
  if (!node || node.type !== "merge") {
    throw new Error("expected a merge node");
  }
  expect(node.data.targetBranch).toBe("release");
});
