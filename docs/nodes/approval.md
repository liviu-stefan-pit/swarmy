# Approval

Palette label: **Approval**. Type id: `approval`.

An Approval node is the human checkpoint. A person reviews a diff before it is allowed to flow downstream. Rejecting it sends the upstream agent around again with a note.

## On the canvas

Drag **Approval** onto the canvas. It has one red input and one red output, both `diff`.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `diff` | input | `diff` | [Agent](agent.md), another Approval, or [Merge](merge.md) |
| `diff` | output | `diff` | another Approval, an [Agent](agent.md), or Merge |

A text, file, folder, or MCP wire cannot land here. The usual line is Agent `diff` → Approval `diff` → Agent `diff`.

## On a run

Press **Run**. When the upstream agent finishes, this node pauses. The **Inbox** under the canvas lists it, and the second agent has not started. The card pill reads `waiting`.

**Approve** lets the diff continue to the next node. **Reject** needs a reason. That note is added to the upstream agent's prompt, and that agent runs again. Then the inbox asks once more. Three rejections can send the agent around again. The fourth rejection stops the branch. The approval card reads `failed`, and the error says the run stopped after 3 reject cycles.

Quit the app while the inbox is waiting. Reopen it. The same item is still there. Approve or reject from that item. There is no separate **Resume** button while an approval is waiting.

## Later

| Phase | What arrives |
| --- | --- |
| 13 | A side-by-side diff. Edits on the right-hand side are what get approved |

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
