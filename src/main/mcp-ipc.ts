import { ipcMain } from "electron";
import {
  mcpHeaderMapSchema,
  mcpListToolsChannel,
  mcpListToolsPayloadSchema,
  mcpReadHeadersChannel,
  mcpReadHeadersPayloadSchema,
  mcpReadHeadersResultSchema,
  mcpSaveHeadersChannel,
  mcpSaveHeadersPayloadSchema,
  mcpSecretIdSchema,
  mcpToolNamesSchema,
} from "@shared/mcp";
import { listMcpTools } from "./mcp-client";
import { readMcpHeaders, saveMcpHeaders } from "./secret-store";

export function registerMcpIpc(): void {
  ipcMain.handle(mcpSaveHeadersChannel, (_event, payload: unknown) => {
    const parsed = mcpSaveHeadersPayloadSchema.parse(payload);
    const secretId = saveMcpHeaders(parsed.headers, parsed.secretId);
    return mcpSecretIdSchema.parse({ secretId });
  });

  ipcMain.handle(mcpReadHeadersChannel, (_event, payload: unknown) => {
    const parsed = mcpReadHeadersPayloadSchema.parse(payload);
    const headers = readMcpHeaders(parsed.secretId) ?? {};
    return mcpReadHeadersResultSchema.parse({ headers: mcpHeaderMapSchema.parse(headers) });
  });

  ipcMain.handle(mcpListToolsChannel, async (_event, payload: unknown) => {
    const parsed = mcpListToolsPayloadSchema.parse(payload);
    const headers = parsed.headerSecretId ? (readMcpHeaders(parsed.headerSecretId) ?? undefined) : undefined;
    try {
      const tools = await listMcpTools({
        transport: parsed.transport,
        ...(parsed.command ? { command: parsed.command } : {}),
        ...(parsed.args ? { args: parsed.args } : {}),
        ...(parsed.url ? { url: parsed.url } : {}),
        ...(headers ? { headers } : {}),
      });
      return mcpToolNamesSchema.parse(tools);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "The MCP server did not list tools.";
      throw new Error(scrubHeaders(message, headers), { cause: error });
    }
  });
}

function scrubHeaders(message: string, headers: Record<string, string> | undefined): string {
  if (!headers) return message;
  let next = message;
  for (const value of Object.values(headers)) {
    if (value.length === 0) continue;
    next = next.split(value).join("[redacted]");
  }
  return next;
}
