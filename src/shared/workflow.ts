import { z } from "zod";

export const handleDirectionSchema = z.enum(["input", "output"]);

export const handleDataTypeSchema = z.enum(["text", "file", "folder", "diff", "mcp"]);

export const handleSchema = z.object({
  id: z.string().min(1),
  direction: handleDirectionSchema,
  type: handleDataTypeSchema,
  label: z.string().min(1),
});

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

export const nodeTypeIdSchema = z.enum([
  "agent",
  "approval",
  "fileInput",
  "folderInput",
  "textInput",
  "mcp",
  "merge",
  "planner",
]);

export const workspaceModeSchema = z.enum(["repo", "managed", "folder"]);

export const labelDataSchema = z.strictObject({
  label: z.string().min(1),
});

export const textInputDataSchema = z.strictObject({
  label: z.string().min(1),
  text: z.string().optional(),
});

export const fileInputDataSchema = z.strictObject({
  label: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
});

export const folderInputDataSchema = z.strictObject({
  label: z.string().min(1),
  folderPath: z.string().min(1).optional(),
});

export const mcpTransportSchema = z.enum(["stdio", "http"]);

export const mcpNodeDataSchema = z.strictObject({
  label: z.string().min(1),
  transport: mcpTransportSchema.default("stdio"),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  url: z.string().min(1).optional(),
  headerSecretId: z.string().min(1).optional(),
});

// `tools` and `disallowedTools` stay optional. An empty array is a real value
// (no built-in tools). A missing field means the SDK default. Do not default either one.
export const agentNodeDataSchema = z.strictObject({
  label: z.string().min(1),
  modelId: z.string().optional(),
  systemPrompt: z.string().optional(),
  taskPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  folderPath: z.string().min(1).optional(),
  guardrails: z.boolean().optional(),
  writePaths: z.array(z.string().min(1)).optional(),
  sandboxEnabled: z.boolean().optional(),
  autoReview: z.boolean().optional(),
});

function workflowNode<const Type extends string, Data extends z.ZodType>(type: Type, data: Data) {
  return z.strictObject({
    id: z.string().min(1),
    type: z.literal(type),
    position: positionSchema,
    data,
  });
}

export const plannerNodeDataSchema = z.strictObject({
  label: z.string().min(1),
  modelId: z.string().optional(),
  systemPrompt: z.string().optional(),
  taskPrompt: z.string().optional(),
  workspaceMode: workspaceModeSchema.optional(),
  folderPath: z.string().min(1).optional(),
});

export const mergeNodeDataSchema = z.strictObject({
  label: z.string().min(1),
  targetBranch: z.string().min(1).default("main"),
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  workflowNode("agent", agentNodeDataSchema),
  workflowNode("approval", labelDataSchema),
  workflowNode("fileInput", fileInputDataSchema),
  workflowNode("folderInput", folderInputDataSchema),
  workflowNode("textInput", textInputDataSchema),
  workflowNode("mcp", mcpNodeDataSchema),
  workflowNode("merge", mergeNodeDataSchema),
  workflowNode("planner", plannerNodeDataSchema),
]);

export const workflowEdgeSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
});

export const requiredEnvVarNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const requiredEnvVarsSchema = z.array(requiredEnvVarNameSchema);

const workflowObjectSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  viewport: viewportSchema,
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  repositoryPath: z.string().min(1).optional(),
  budgetTokens: z.number().int().positive().optional(),
  requiredEnvVars: requiredEnvVarsSchema.optional(),
});

export const workflowSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("budgetUsd" in value)) {
    return value;
  }
  const record = { ...(value as Record<string, unknown>) };
  delete record.budgetUsd;
  return record;
}, workflowObjectSchema);

export type HandleDirection = z.infer<typeof handleDirectionSchema>;
export type HandleDataType = z.infer<typeof handleDataTypeSchema>;
export type Handle = z.infer<typeof handleSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type NodeTypeId = z.infer<typeof nodeTypeIdSchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type LabelNodeData = z.infer<typeof labelDataSchema>;
export type TextInputNodeData = z.infer<typeof textInputDataSchema>;
export type FileInputNodeData = z.infer<typeof fileInputDataSchema>;
export type FolderInputNodeData = z.infer<typeof folderInputDataSchema>;
export type McpNodeData = z.infer<typeof mcpNodeDataSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type AgentNodeData = z.infer<typeof agentNodeDataSchema>;
export type PlannerNodeData = z.infer<typeof plannerNodeDataSchema>;
export type MergeNodeData = z.infer<typeof mergeNodeDataSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type RequiredEnvVarName = z.infer<typeof requiredEnvVarNameSchema>;
