import { z } from "zod";
import { workflowSchema } from "./workflow";

export const workflowListChannel = "workflows:list";
export const workflowLoadChannel = "workflows:load";
export const workflowSaveChannel = "workflows:save";
export const workflowDeleteChannel = "workflows:delete";

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

export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;
