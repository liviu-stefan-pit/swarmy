# MCP

Palette label: **MCP**. Type id: `mcp`.

An MCP node is an external tool server an agent can call. MCP is the way Swarmy attaches tools. It is a source. It has no inputs.

## On the canvas

Drag **MCP** onto the canvas. The card has one output, **MCP**, in violet, and a **Delete** button that removes this node and any wires attached to it.

That output connects only to an [Agent](agent.md) `mcp` input. One server can feed several agents.

## The server

Select the card. **Transport** is `stdio` or `http`.

- `stdio` asks for a **Command** and **Arguments**, one argument per line. Swarmy starts that program and talks to it on stdin.
- `http` asks for a **URL**. Optional **Headers** are a name and a value. **Save headers** stores the values with Electron `safeStorage` on this PC and keeps only `headerSecretId` in the workflow. The header value is not in the workflow JSON (decision D10).

**Test connection** asks the server for its tools and lists the names on this card. Saving the workflow does not save that list.

Wiring this output to an agent adds the server when that agent is created and again when that agent is resumed.

## Schema

```json
{
  "id": "tools",
  "type": "mcp",
  "position": { "x": 0, "y": 0 },
  "data": {
    "label": "MCP",
    "transport": "stdio",
    "command": "node",
    "args": ["C:\\prod\\swarmy\\scripts\\mcp-list-server.mjs"]
  }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `mcp` | output | `mcp` |
