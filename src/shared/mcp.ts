import { z } from "zod";
import { mcpTransportSchema } from "./workflow";

export const mcpHeaderMapSchema = z.record(z.string().min(1), z.string());

export const mcpHeadersBySecretSchema = z.record(z.string().min(1), mcpHeaderMapSchema);

export const mcpSaveHeadersChannel = "mcp:save-headers";
export const mcpReadHeadersChannel = "mcp:read-headers";
export const mcpListToolsChannel = "mcp:list-tools";

export const mcpSaveHeadersPayloadSchema = z.object({
  headers: mcpHeaderMapSchema,
  secretId: z.string().uuid().optional(),
});

export const mcpSecretIdSchema = z.object({
  secretId: z.string().min(1),
});

export const mcpReadHeadersPayloadSchema = z.object({
  secretId: z.string().min(1),
});

export const mcpReadHeadersResultSchema = z.object({
  headers: mcpHeaderMapSchema,
});

export const mcpListToolsPayloadSchema = z.object({
  transport: mcpTransportSchema,
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  url: z.string().min(1).optional(),
  headerSecretId: z.string().min(1).optional(),
});

export const mcpToolNamesSchema = z.array(z.string().min(1));

export type McpListToolsPayload = z.infer<typeof mcpListToolsPayloadSchema>;
