import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApprovalInbox } from "./ApprovalInbox";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

vi.mock("./DiffReview", () => ({
  DiffReview({ modified, onChange }: { modified: string; onChange: (text: string) => void }) {
    return (
      <textarea
        data-testid="diff-modified"
        defaultValue={modified}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useRunStore.setState({
    workflowRunning: true,
    approvals: [
      {
        nodeId: "review",
        summary: "wrote the change",
        workspacePath: "C:\\wt\\writer",
        files: [{ path: "README.md", original: "hello\n", modified: "hello world\n" }],
      },
    ],
  });
  useWorkflowStore.setState({
    workflow: {
      id: "diff-review",
      name: "Diff review",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "review",
          type: "approval",
          position: { x: 0, y: 0 },
          data: { label: "Review" },
        },
      ],
      edges: [],
    },
  });
});

it("sends the edited right-hand side when you approve", async () => {
  const decide = vi.spyOn(window.swarmy.runs, "decide").mockResolvedValue(undefined);
  render(<ApprovalInbox />);

  expect(await screen.findByTestId("diff-file")).toHaveTextContent("README.md");
  expect(screen.getByTestId("diff-worktree")).toHaveTextContent("C:\\wt\\writer");
  fireEvent.change(await screen.findByTestId("diff-modified"), { target: { value: "approved word\n" } });
  fireEvent.click(screen.getByTestId("approval-approve"));

  expect(decide).toHaveBeenCalledWith({
    nodeId: "review",
    action: "approve",
    files: [{ path: "README.md", text: "approved word\n" }],
  });
});

it("does not send the edited buffer when you reject", async () => {
  const decide = vi.spyOn(window.swarmy.runs, "decide").mockResolvedValue(undefined);
  render(<ApprovalInbox />);

  fireEvent.change(await screen.findByTestId("diff-modified"), { target: { value: "should not land\n" } });
  fireEvent.change(screen.getByTestId("approval-reject-reason"), { target: { value: "try again" } });
  fireEvent.click(screen.getByTestId("approval-reject"));

  expect(decide).toHaveBeenCalledWith({
    nodeId: "review",
    action: "reject",
    reason: "try again",
  });
});
