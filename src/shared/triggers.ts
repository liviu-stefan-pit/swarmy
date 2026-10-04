import { z } from "zod";

export const focusInboxChannel = "run:focus-inbox";
export const triggerRunChannel = "trigger:run";
export const triggerSkipChannel = "trigger:skipped";

export const triggerSkipSchema = z.object({
  workflowId: z.string().min(1),
  path: z.string(),
  reason: z.literal("skipped"),
  at: z.number(),
});

export const triggerRunEventSchema = z.object({
  workflowId: z.string().min(1),
  state: z.enum(["started", "finished"]),
  message: z.string().min(1).optional(),
});

export type TriggerSkip = z.infer<typeof triggerSkipSchema>;
export type TriggerRunEvent = z.infer<typeof triggerRunEventSchema>;
