# Agent

Palette label: **Agent**. Type id: `agent`.

An Agent is a Cursor agent. It is the worker in the swarm. It can read text, a file, a folder, and MCP servers. It produces a reply and a diff.

## On the canvas

Drag **Agent** onto the canvas. The card shows the label and a status pill. The pill reads `idle` until a later phase runs the node.

Inputs are on the left. Outputs are on the right.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `text` | input | `text` | [Text](text-input.md), another Agent, [Planner](planner.md), or [Merge](merge.md) |
| `file` | input | `file` | [File](file-input.md) |
| `folder` | input | `folder` | [Folder](folder-input.md) |
| `mcp` | input | `mcp` | [MCP](mcp.md) |
| `text` | output | `text` | another Agent, Planner, or Merge |
| `diff` | output | `diff` | [Approval](approval.md) or Merge |

The `diff` output cannot land on the `file` input. Those types differ, and the canvas refuses the edge. `examples/bad-handle.json` is that mistake.

Several sources may share one input. A Text node and a Planner may both wire into the same Agent `text` handle.

## Later

| Phase | What arrives |
| --- | --- |
| 6 | Label, model, prompts, tool allow and deny lists, workspace mode |
| 8 | Run one agent, watch its log, cancel it |
| 9 | A workspace per run: repo, managed folder, or plain folder |
| 10 | The whole graph runs, and this node's text and diff are the handoff |
| 14 | Tool limits and a hook that blocks dangerous shell commands |

## Schema

```json
{
  "id": "writer",
  "type": "agent",
  "position": { "x": 280, "y": 40 },
  "data": { "label": "Writer" }
}
```

`data` is only `label` until Phase 6.
