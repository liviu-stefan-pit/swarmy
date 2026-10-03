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

export const engineMessageSchema = z.discriminatedUnion("type", [
  engineHelloMessageSchema,
  engineReadyMessageSchema,
  enginePingMessageSchema,
  enginePongMessageSchema,
]);

export type EngineMessage = z.infer<typeof engineMessageSchema>;

export function parseEngineMessage(input: unknown): EngineMessage {
  return engineMessageSchema.parse(input);
}

export const engineStatusSchema = z.enum(["connected", "reconnecting"]);

export type EngineStatus = z.infer<typeof engineStatusSchema>;

export const engineStatusChannel = "engine:status";
