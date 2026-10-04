import { expect, it } from "vitest";
import { exportWorkflowJson, rememberMcpHeaders, type McpHeaderStore } from "./mcp-headers";
import type { Workflow } from "./workflow";

class MemoryHeaderStore implements McpHeaderStore {
  private readonly saved = new Map<string, Record<string, string>>();

  save(headers: Record<string, string>): string {
    const id = `secret-${this.saved.size + 1}`;
    this.saved.set(id, { ...headers });
    return id;
  }

  read(secretId: string): Record<string, string> | null {
    const found = this.saved.get(secretId);
    return found ? { ...found } : null;
  }
}

function mcpWorkflow(): Workflow {
  return {
    id: "mcp-doc",
    name: "MCP document",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "tools",
        type: "mcp",
        position: { x: 0, y: 0 },
        data: { label: "Tools", transport: "http", url: "http://127.0.0.1:9/mcp" },
      },
    ],
    edges: [],
  };
}

it("exporting the workflow JSON after an MCP header is saved does not contain the header value", () => {
  const headerValue = "super-secret-mcp-header";
  const store = new MemoryHeaderStore();
  const workflow = rememberMcpHeaders(mcpWorkflow(), "tools", { Authorization: headerValue }, store);
  const json = exportWorkflowJson(workflow);

  expect(json).not.toContain(headerValue);
  expect(json).toContain("secret-1");
  expect(store.read("secret-1")).toEqual({ Authorization: headerValue });
});
