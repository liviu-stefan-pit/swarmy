import { z } from "zod";
import { workflowSchema, workspaceModeSchema } from "./workflow";

export const nodeRunStatusSchema = z.enum([
  "idle",
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const approvalDiffFileSchema = z.object({
  path: z.string().min(1),
  original: z.string(),
  modified: z.string(),
});

export const approvalEditSchema = z.object({
  path: z.string().min(1),
  text: z.string(),
});

export const runUpdateSchema = z.object({
  nodeId: z.string().min(1),
  status: z.enum(["queued", "running", "waiting", "completed", "failed", "cancelled"]),
  log: z.string(),
  workspacePath: z.string().min(1).optional(),
  files: z.array(approvalDiffFileSchema).optional(),
});

export const runStartPayloadSchema = z.object({
  nodeId: z.string().min(1),
  prompt: z.string(),
  modelId: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  repositoryPath: z.string().min(1).optional(),
  folderPath: z.string().min(1).optional(),
});

export const runCancelPayloadSchema = z.object({
  nodeId: z.string().min(1),
});

export const runSteerPayloadSchema = z.object({
  nodeId: z.string().min(1),
  text: z.string().min(1),
});

export const steerDeliverySchema = z.enum(["complete_delivered", "revert_to_followup"]);

export const runUnfinishedPayloadSchema = z.object({
  workflowId: z.string().min(1),
});

export const pendingApprovalSchema = z.object({
  nodeId: z.string().min(1),
  summary: z.string(),
  files: z.array(approvalDiffFileSchema).default([]),
  workspacePath: z.string().min(1).optional(),
});

export const approvalDecisionSchema = z.object({
  nodeId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
  files: z.array(approvalEditSchema).optional(),
});

export const approvalListPayloadSchema = z.object({
  workflow: workflowSchema,
  threadId: z.string().min(1),
});

export const workflowResumePayloadSchema = z.object({
  workflow: workflowSchema,
  threadId: z.string().min(1),
  decision: approvalDecisionSchema.optional(),
});

export const workflowRunResultSchema = z.object({
  statuses: z.record(z.string(), nodeRunStatusSchema),
});

export const runStartChannel = "run:start";
export const runCancelChannel = "run:cancel";
export const runSteerChannel = "run:steer";
export const runUnfinishedChannel = "run:unfinished";
export const runUpdateChannel = "run:update";
export const workflowRunChannel = "workflow:run";
export const workflowCancelChannel = "workflow:cancel";
export const workflowResumeChannel = "workflow:resume";
export const approvalListChannel = "approval:list";
export const approvalDecideChannel = "approval:decide";

export type NodeRunStatus = z.infer<typeof nodeRunStatusSchema>;
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type RunUpdate = z.infer<typeof runUpdateSchema>;
export type RunStart = z.infer<typeof runStartPayloadSchema>;
export type RunDone = RunUpdate;
export type SteerDelivery = z.infer<typeof steerDeliverySchema>;
export type WorkflowRunResult = z.infer<typeof workflowRunResultSchema>;