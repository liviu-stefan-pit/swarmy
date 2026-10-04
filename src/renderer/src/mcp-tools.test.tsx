import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react";
import { NodeInspector } from "./NodeInspector";
import { WorkflowNodeCard } from "./WorkflowNodeCard";
import { useWorkflowStore } from "./workflow-store";

afterEach(() => {
  cleanup();
});

it("a fake MCP list tools result renders the tool names in the node", () => {
  const data = { label: "MCP", mcpTools: ["read_file", "search"] };
  const props = {
    id: "mcp-1",
    type: "mcp",
    data,
    selected: false,
    dragging: false,
    zIndex: 1,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  } as NodeProps<Node<{ label: string; mcpTools?: readonly string[] }>>;

  render(
    <ReactFlowProvider>
      <WorkflowNodeCard {...props} />
    </ReactFlowProvider>,
  );

  const tools = screen.getByTestId("mcp-tools");
  expect(tools).toHaveTextContent("read_file");
  expect(tools).toHaveTextContent("search");
});

it("shows the MCP inspector after the node is added", () => {
  useWorkflowStore.setState(useWorkflowStore.getInitialState(), true);
  useWorkflowStore.getState().addNode("mcp", { x: 0, y: 0 });
  render(<NodeInspector />);
  expect(screen.getByTestId("inspector-mcp-transport")).toHaveValue("stdio");
});
