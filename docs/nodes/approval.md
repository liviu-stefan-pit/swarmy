# Approval

Palette label: **Approval**. Type id: `approval`.

An Approval node is the human checkpoint. A person reviews a diff before it is allowed to flow downstream. Rejecting it sends the upstream agent around again with a note.

## On the canvas

Drag **Approval** onto the canvas. It has one red input and one red output, both `diff`.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `diff` | input | `diff` | [Agent](agent.md), another Approval, or [Merge](merge.md) |
| `diff` | output | `diff` | another Approval, or Merge |

A text, file, folder, or MCP wire cannot land here. The usual line is Agent `diff` → Approval `diff`.

## Later

| Phase | What arrives |
| --- | --- |
| 12 | The run pauses on this node. An inbox lists it. Approve continues. Reject, with a reason, reruns the upstream agent, up to 3 cycles |
| 13 | A side-by-side diff. Edits on the right-hand side are what get approved |

Until Phase 12 the card is only the diff gate in the graph. The run does not pause here yet.

## Schema

```json
{
  "id": "review",
  "type": "approval",
  "position": { "x": 560, "y": 40 },
  "data": { "label": "Approval" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `diff` | input | `diff` |
| `diff` | output | `diff` |
