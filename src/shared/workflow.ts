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
});

function workflowNode<const Type extends string, Data extends z.ZodType>(type: Type, data: Data) {
  return z.strictObject({
    id: z.string().min(1),
    type: z.literal(type),
    position: positionSchema,
    data,
  });
}

export const workflowNodeSchema = z.discriminatedUnion("type", [
  workflowNode("agent", agentNodeDataSchema),
  workflowNode("approval", labelDataSchema),
  workflowNode("fileInput", labelDataSchema),
  workflowNode("folderInput", labelDataSchema),
  workflowNode("textInput", labelDataSchema),
  workflowNode("mcp", labelDataSchema),
  workflowNode("merge", labelDataSchema),
  workflowNode("planner", labelDataSchema),
]);

export const workflowEdgeSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
});

export const workflowSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  viewport: viewportSchema,
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export type HandleDirection = z.infer<typeof handleDirectionSchema>;
export type HandleDataType = z.infer<typeof handleDataTypeSchema>;
export type Handle = z.infer<typeof handleSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type NodeTypeId = z.infer<typeof nodeTypeIdSchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type LabelNodeData = z.infer<typeof labelDataSchema>;
export type AgentNodeData = z.infer<typeof agentNodeDataSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
