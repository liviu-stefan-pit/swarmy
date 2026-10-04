import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApprovalInbox } from "./ApprovalInbox";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

vi.mock("./DiffReview", () => ({
  DiffReview() {
    throw new Error("monaco failed");
  },
}));

it("keeps the inbox on screen when the diff editor fails to load", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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
  useRunStore.setState({
    workflowRunning: true,
    approvals: [
      {
        nodeId: "review",
        summary: "wrote the change",
        files: [{ path: "README.md", original: "hello\n", modified: "hello world\n" }],
      },
    ],
  });

  render(<ApprovalInbox />);

  expect(await screen.findByTestId("diff-error")).toHaveTextContent("Diff failed to load");
  expect(screen.getByTestId("approval-inbox")).toBeInTheDocument();
  expect(screen.getByTestId("approval-approve")).toBeInTheDocument();
});
