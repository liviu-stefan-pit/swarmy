import { z } from "zod";

export const nodeRunStatusSchema = z.enum(["idle", "running", "completed", "failed", "cancelled"]);

export const runUpdateSchema = z.object({
  nodeId: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  log: z.string(),
});

export const runStartPayloadSchema = z.object({
  nodeId: z.string().min(1),
  prompt: z.string(),
  modelId: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
});

export const runCancelPayloadSchema = z.object({
  nodeId: z.string().min(1),
});

export const runStartChannel = "run:start";
export const runCancelChannel = "run:cancel";
export const runUpdateChannel = "run:update";

export type NodeRunStatus = z.infer<typeof nodeRunStatusSchema>;
export type RunUpdate = z.infer<typeof runUpdateSchema>;
export type RunStart = z.infer<typeof runStartPayloadSchema>;
export type RunDone = RunUpdate;