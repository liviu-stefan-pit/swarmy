# MCP

Palette label: **MCP**. Type id: `mcp`.

An MCP node is an external tool server an agent can call. MCP is the way Swarmy attaches tools. It is a source. It has no inputs.

## On the canvas

Drag **MCP** onto the canvas. The card has one output, **MCP**, in violet.

That output connects only to an [Agent](agent.md) `mcp` input. One server can feed several agents.

## Later

Phase 20 adds the server config (a local command, or an HTTP url), a test button that lists the server's tools, and secret storage for headers. Header values stay out of the workflow JSON (decision D10). Until then the card is only a labeled source in the graph.

## Schema

```json
{
  "id": "tools",
  "type": "mcp",
  "position": { "x": 0, "y": 0 },
  "data": { "label": "MCP" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `mcp` | output | `mcp` |
