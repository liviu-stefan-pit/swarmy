# Folder

Palette label: **Folder**. Type id: `folderInput`.

A Folder node hands a directory to a downstream node. It is a source. It has no inputs.

## On the canvas

Drag **Folder** onto the canvas. The card has one output, **Folder**, in green, and a **Delete** button that removes this node and any wires attached to it.

That output connects only to an [Agent](agent.md) `folder` input.

## The folder

Select the card. The inspector has **Folder** (`inspector-folder-path`). Type the directory the agent should use.

When this output is wired to an agent, that agent runs in `folder` mode at this path, even if the agent card has another workspace mode. The folder stays where it is. Swarmy does not delete it.

## Schema

```json
{
  "id": "workspace",
  "type": "folderInput",
  "position": { "x": 0, "y": 0 },
  "data": { "label": "Folder", "folderPath": "C:\\work\\notes" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `folder` | output | `folder` |
