import { resolve } from "node:path";
import { expect, it } from "vitest";
import { listMcpTools } from "./mcp-client";

it("lists tool names from a local stdio MCP server", async () => {
  const tools = await listMcpTools({
    transport: "stdio",
    command: process.execPath,
    args: [resolve("scripts/mcp-list-server.mjs")],
  });
  expect(tools).toEqual(["echo", "ping"]);
});
