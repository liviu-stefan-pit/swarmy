import { z } from "zod";

export const saveKeyChannel = "settings:save-key";
export const hasKeyChannel = "settings:has-key";
export const testConnectionChannel = "settings:test-connection";
export const helloChannel = "settings:hello";

export const saveKeyPayloadSchema = z.object({
  apiKey: z.string().trim().min(1),
});

export const connectionInfoSchema = z.object({
  accountLabel: z.string().min(1),
  modelIds: z.array(z.string().min(1)),
});

export const helloInfoSchema = z.object({
  text: z.string(),
  systemPromptAccepted: z.boolean(),
  warning: z.string().min(1).optional(),
  cwd: z.string().min(1),
});

export type ConnectionInfo = z.infer<typeof connectionInfoSchema>;
export type HelloInfo = z.infer<typeof helloInfoSchema>;
