import { z } from "zod";

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
]);

export type EngineMessage = z.infer<typeof engineMessageSchema>;

export function parseEngineMessage(input: unknown): EngineMessage {
  return engineMessageSchema.parse(input);
}

export const engineStatusSchema = z.enum(["connected", "reconnecting"]);

export type EngineStatus = z.infer<typeof engineStatusSchema>;

export const engineStatusChannel = "engine:status";
