import { z } from "zod";
import { workflowSchema } from "./workflow";

export const workflowListChannel = "workflows:list";
export const workflowLoadChannel = "workflows:load";
export const workflowSaveChannel = "workflows:save";
export const workflowDeleteChannel = "workflows:delete";
export const workflowExportChannel = "workflows:export";
export const workflowImportChannel = "workflows:import";
export const workflowImportCommitChannel = "workflows:import-commit";

export const workflowIdPayloadSchema = z.object({
  id: z.string().min(1),
});

export const workflowSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const workflowListResultSchema = z.array(workflowSummarySchema);

export const workflowSavePayloadSchema = workflowSchema;

export const workflowExportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }),
  z.object({ status: z.literal("saved"), path: z.string().min(1) }),
]);

export const workflowImportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }),
  z.object({
    status: z.literal("needsSecrets"),
    missingSecrets: z.array(z.string().min(1)),
    workflow: workflowSchema,
  }),
  z.object({
    status: z.literal("saved"),
    summary: workflowSummarySchema,
    workflow: workflowSchema,
  }),
]);

export const workflowImportCommitPayloadSchema = z.object({
  workflow: workflowSchema,
  secrets: z.record(z.string().min(1), z.string().min(1)),
});

export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;
export type WorkflowExportResult = z.infer<typeof workflowExportResultSchema>;
export type WorkflowImportResult = z.infer<typeof workflowImportResultSchema>;
