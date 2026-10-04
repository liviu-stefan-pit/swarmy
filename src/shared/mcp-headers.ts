import { workflowSchema, type Workflow } from "./workflow";

export interface McpHeaderStore {
  save(headers: Record<string, string>): string;
  read(secretId: string): Record<string, string> | null;
}

export function rememberMcpHeaders(
  workflow: Workflow,
  nodeId: string,
  headers: Record<string, string>,
  store: McpHeaderStore,
): Workflow {
  const secretId = store.save(headers);
  let found = false;
  const nodes = workflow.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== "mcp") {
      return node;
    }
    found = true;
    return {
      ...node,
      data: {
        ...node.data,
        headerSecretId: secretId,
      },
    };
  });
  if (!found) {
    throw new Error("MCP node was not found");
  }
  return workflowSchema.parse({ ...workflow, nodes });
}

export function exportWorkflowJson(workflow: Workflow): string {
  return JSON.stringify(workflowSchema.parse(workflow));
}
