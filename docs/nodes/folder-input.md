# Folder

Palette label: **Folder**. Type id: `folderInput`.

A Folder node hands a directory to a downstream node. It is a source. It has no inputs.

## On the canvas

Drag **Folder** onto the canvas. The card has one output, **Folder**, in green, and a **Delete** button that removes this node and any wires attached to it.

That output connects only to an [Agent](agent.md) `folder` input.

## Later

Phase 20 uses this node to set the agent's workspace to folder mode and point it at the chosen directory. Workspace creation itself is Phase 9. Until then the card is only a labeled source in the graph.

## Schema

```json
{
  "id": "workspace",
  "type": "folderInput",
  "position": { "x": 0, "y": 0 },
  "data": { "label": "Folder" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `folder` | output | `folder` |
