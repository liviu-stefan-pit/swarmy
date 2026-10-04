import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function cardByLabel(label: string): HTMLElement {
  const card = screen.getAllByTestId("canvas-node").find((node) => node.querySelector("h3")?.textContent === label);
  if (!card) {
    throw new Error(`missing card ${label}`);
  }
  return card;
}

function deleteButton(label: string): HTMLButtonElement {
  const button = cardByLabel(label).querySelector("[data-testid='delete-node']");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("missing delete-node");
  }
  return button;
}

async function flushKeyDelete(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function graphWithAgent(): { agentId: string } {
  useWorkflowStore.getState().addNode("textInput", { x: 0, y: 0 });
  useWorkflowStore.getState().addNode("agent", { x: 240, y: 0 });
  const [text, agent] = useWorkflowStore.getState().workflow.nodes;
  if (!text || !agent) {
    throw new Error("expected a text node and an agent");
  }
  useWorkflowStore.getState().connect({
    source: text.id,
    sourceHandle: "text",
    target: agent.id,
    targetHandle: "text",
  });
  useWorkflowStore.getState().selectNode(agent.id);
  return { agentId: agent.id };
}

it("Delete and Backspace, while the task prompt is focused, leave the node in place", async () => {
  const { agentId } = graphWithAgent();
  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas />
      <NodeInspector />
    </div>,
  );

  const prompt = screen.getByTestId("inspector-task-prompt");
  prompt.focus();
  fireEvent.keyDown(prompt, { key: "Delete", code: "Delete" });
  fireEvent.keyDown(prompt, { key: "Backspace", code: "Backspace" });
  await flushKeyDelete();

  const afterTyping = useWorkflowStore.getState();
  expect(afterTyping.workflow.nodes.some((node) => node.id === agentId)).toBe(true);
  expect(afterTyping.workflow.edges).toHaveLength(1);

  prompt.blur();
  fireEvent.keyDown(screen.getByTestId("workflow-canvas"), { key: "Delete", code: "Delete" });
  await flushKeyDelete();

  const afterDelete = useWorkflowStore.getState();
  expect(afterDelete.workflow.nodes.some((node) => node.id === agentId)).toBe(false);
  expect(afterDelete.workflow.edges).toEqual([]);
  expect(afterDelete.workflow.nodes).toHaveLength(1);
});

it("the card Delete button removes that node", () => {
  const { agentId } = graphWithAgent();
  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas />
    </div>,
  );

  fireEvent.click(deleteButton("Agent"));

  const next = useWorkflowStore.getState();
  expect(next.workflow.nodes.some((node) => node.id === agentId)).toBe(false);
  expect(next.workflow.nodes.map((node) => node.type)).toEqual(["textInput"]);
  expect(next.workflow.edges).toEqual([]);
  expect(next.selectedNodeId).toBeNull();
});

it("does not delete a running node or any node during a workflow run", async () => {
  const { agentId } = graphWithAgent();
  useRunStore.setState({ statusByNode: { [agentId]: "running" } });
  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas />
    </div>,
  );

  const runningButton = deleteButton("Agent");
  expect(runningButton).toBeDisabled();
  fireEvent.click(runningButton);
  fireEvent.keyDown(screen.getByTestId("workflow-canvas"), { key: "Delete", code: "Delete" });
  await flushKeyDelete();
  expect(useWorkflowStore.getState().workflow.nodes.some((node) => node.id === agentId)).toBe(true);

  useRunStore.setState({ statusByNode: { [agentId]: "idle" }, workflowRunning: true });
  const lockedButton = deleteButton("Agent");
  expect(lockedButton).toBeDisabled();
  fireEvent.click(lockedButton);
  fireEvent.keyDown(screen.getByTestId("workflow-canvas"), { key: "Backspace", code: "Backspace" });
  await flushKeyDelete();
  expect(useWorkflowStore.getState().workflow.nodes.some((node) => node.id === agentId)).toBe(true);
  expect(useWorkflowStore.getState().workflow.edges).toHaveLength(1);
});
