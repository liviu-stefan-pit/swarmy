# Planner

Palette label: **Planner**. Type id: `planner`.

A Planner turns a brief into a plan that other nodes can read. It is for splitting one goal into tasks, including workers that were not drawn one by one on the canvas.

## On the canvas

Drag **Planner** onto the canvas. It has one blue input and one blue output, both `text`, and a **Delete** button that removes this node and any wires attached to it.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `text` | input | `text` | [Text](text-input.md), [Agent](agent.md), another Planner, or [Merge](merge.md) |
| `text` | output | `text` | Agent, another Planner, or Merge |

It does not take a file, a folder, an MCP server, or a diff. It does not produce a diff.

## Later

Phase 18 is the one that makes a Planner spawn workers. The plan is capped at 8 tasks. Those workers show up as rows under the Planner for that run. They are not saved as nodes in the workflow. Until that phase, the Planner is a text-in, text-out card.

## Schema

```json
{
  "id": "split",
  "type": "planner",
  "position": { "x": 280, "y": 0 },
  "data": { "label": "Planner" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `text` | input | `text` |
| `text` | output | `text` |
