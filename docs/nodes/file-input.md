# File

Palette label: **File**. Type id: `fileInput`.

A File node hands one file to a downstream node. It is a source. It has no inputs.

## On the canvas

Drag **File** onto the canvas. The card has one output, **File**, in amber, and a **Delete** button that removes this node and any wires attached to it.

That output connects only to an [Agent](agent.md) `file` input. Planner, Approval, and Merge have no file input, so a wire to them is refused.

## The dropped file

Drop one file onto the card, or choose it in the inspector. The card shows the file name. The workflow stores the path, not the file bytes.

When you press **Run** in the toolbar, Swarmy copies that file into the run's input directory and gives the downstream agent the copied path plus an excerpt of at most 20 KB. The rest of the file stays on disk at that path. A second file node can feed the same agent. Each file is excerpted on its own.

## Schema

```json
{
  "id": "spec",
  "type": "fileInput",
  "position": { "x": 0, "y": 0 },
  "data": { "label": "File", "sourcePath": "C:\\notes\\brief.txt" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `file` | output | `file` |
