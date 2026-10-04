# Text

Palette label: **Text**. Type id: `textInput`.

A Text node is a piece of writing the rest of the graph can read: a brief, a goal, a note. It starts a branch. It does not take input from other nodes.

## On the canvas

Drag **Text** onto the canvas. The card has one output, **Text**, in blue, and a **Delete** button that removes this node and any wires attached to it.

Connect that output to a blue input:

- [Agent](agent.md) `text`
- [Planner](planner.md) `text`
- [Merge](merge.md) `text`

The same Text node can feed several of those at once. That is how one brief reaches two agents in parallel.

## What you type

Select the card. The inspector has **Text** (`inspector-text`). What you type there is added to every downstream agent and planner prompt. The workflow stores that text. It does not store a run log.

## Schema

```json
{
  "id": "brief",
  "type": "textInput",
  "position": { "x": 0, "y": 160 },
  "data": { "label": "Brief", "text": "Ship the notes." }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `text` | output | `text` |
