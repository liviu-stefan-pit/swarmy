import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });

input.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!message || typeof message !== "object") return;
  if (message.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "swarmy-list", version: "0.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Repeat the text you were given.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
          {
            name: "ping",
            description: "Reply with pong.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params && message.params.name;
    const text = message.params && message.params.arguments && message.params.arguments.text;
    const body = name === "echo" ? String(text ?? "") : "pong";
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: body }] },
    });
  }
});

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
