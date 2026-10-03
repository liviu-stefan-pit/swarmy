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

export const workflowNodeSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  position: positionSchema,
  data: z.strictObject({
    label: z.string().min(1),
  }),
});

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
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
