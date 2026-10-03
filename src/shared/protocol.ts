import { z } from "zod";
import { workflowSchema } from "./workflow";
import { workflowSummarySchema } from "./workflows";

export const engineHelloMessageSchema = z.object({
  type: z.literal("engine.hello"),
});

export const engineReadyMessageSchema = z.object({
  type: z.literal("engine.ready"),
});

export const enginePingMessageSchema = z.object({
  type: z.literal("engine.ping"),
  id: z.string().min(1),
});

export const enginePongMessageSchema = z.object({
  type: z.literal("engine.pong"),
  id: z.string().min(1),
});

export const cursorTestMessageSchema = z.object({
  type: z.literal("cursor.test"),
  id: z.string().min(1),
  apiKey: z.string().min(1),
});

export const cursorTestResultMessageSchema = z.object({
  type: z.literal("cursor.testResult"),
  id: z.string().min(1),
  accountLabel: z.string().min(1),
  modelIds: z.array(z.string().min(1)),
});

export const cursorHelloMessageSchema = z.object({
  type: z.literal("cursor.hello"),
  id: z.string().min(1),
  apiKey: z.string().min(1),
});

export const cursorHelloResultMessageSchema = z.object({
  type: z.literal("cursor.helloResult"),
  id: z.string().min(1),
  text: z.string(),
  systemPromptAccepted: z.boolean(),
  warning: z.string().min(1).optional(),
  cwd: z.string().min(1),
});

export const cursorFailedMessageSchema = z.object({
  type: z.literal("cursor.failed"),
  id: z.string().min(1),
  message: z.string().min(1),
});

export const sqliteProbeResultMessageSchema = z.object({
  type: z.literal("sqlite.probeResult"),
  ok: z.boolean(),
  value: z.string().optional(),
  message: z.string().optional(),
});

export const workflowSaveMessageSchema = z.object({
  type: z.literal("workflow.save"),
  id: z.string().min(1),
  workflow: workflowSchema,
});

export const workflowSaveResultMessageSchema = z.object({
  type: z.literal("workflow.saveResult"),
  id: z.string().min(1),
  summary: workflowSummarySchema,
});

export const workflowLoadMessageSchema = z.object({
  type: z.literal("workflow.load"),
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

export const workflowLoadResultMessageSchema = z.object({
  type: z.literal("workflow.loadResult"),
  id: z.string().min(1),
  workflow: workflowSchema,
});

export const workflowListMessageSchema = z.object({
  type: z.literal("workflow.list"),
  id: z.string().min(1),
});

export const workflowListResultMessageSchema = z.object({
  type: z.literal("workflow.listResult"),
  id: z.string().min(1),
  workflows: z.array(workflowSummarySchema),
});

export const workflowDeleteMessageSchema = z.object({
  type: z.literal("workflow.delete"),
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

export const workflowDeleteResultMessageSchema = z.object({
  type: z.literal("workflow.deleteResult"),
  id: z.string().min(1),
});

export const workflowFailedMessageSchema = z.object({
  type: z.literal("workflow.failed"),
  id: z.string().min(1),
  message: z.string().min(1),
});

export const engineMessageSchema = z.discriminatedUnion("type", [
  engineHelloMessageSchema,
  engineReadyMessageSchema,
  enginePingMessageSchema,
  enginePongMessageSchema,
  cursorTestMessageSchema,
  cursorTestResultMessageSchema,
  cursorHelloMessageSchema,
  cursorHelloResultMessageSchema,
  cursorFailedMessageSchema,
  sqliteProbeResultMessageSchema,
  workflowSaveMessageSchema,
  workflowSaveResultMessageSchema,
  workflowLoadMessageSchema,
  workflowLoadResultMessageSchema,
  workflowListMessageSchema,
  workflowListResultMessageSchema,
  workflowDeleteMessageSchema,
  workflowDeleteResultMessageSchema,
  workflowFailedMessageSchema,
]);

export type EngineMessage = z.infer<typeof engineMessageSchema>;

export function parseEngineMessage(input: unknown): EngineMessage {
  return engineMessageSchema.parse(input);
}

export const engineStatusSchema = z.enum(["connected", "reconnecting"]);

export type EngineStatus = z.infer<typeof engineStatusSchema>;

export const engineStatusChannel = "engine:status";
