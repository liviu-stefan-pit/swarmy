# File

Palette label: **File**. Type id: `fileInput`.

A File node hands one file to a downstream node. It is a source. It has no inputs.

## On the canvas

Drag **File** onto the canvas. The card has one output, **File**, in amber, and a **Delete** button that removes this node and any wires attached to it.

That output connects only to an [Agent](agent.md) `file` input. Planner, Approval, and Merge have no file input, so a wire to them is refused.

## Later

Phase 20 copies a dropped file into the run and gives the agent a path plus an excerpt of at most 20 KB. Until then the card is only a labeled source in the graph.

## Schema

```json
{
  "id": "spec",
  "type": "fileInput",
  "position": { "x": 0, "y": 0 },
  "data": { "label": "File" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `file` | output | `file` |
