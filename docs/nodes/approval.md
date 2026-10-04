# Approval

Palette label: **Approval**. Type id: `approval`.

An Approval node is the human checkpoint. A person reviews a diff before it is allowed to flow downstream. Rejecting it sends the upstream agent around again with a note.

## On the canvas

Drag **Approval** onto the canvas. It has one red input and one red output, both `diff`, and a **Delete** button that removes this node and any wires attached to it. The button is disabled, and Delete and Backspace do nothing, while this node is running or a workflow run is in progress.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `diff` | input | `diff` | [Agent](agent.md), another Approval, or [Merge](merge.md) |
| `diff` | output | `diff` | another Approval, an [Agent](agent.md), or Merge |

A text, file, folder, or MCP wire cannot land here. The usual line is Agent `diff` → Approval `diff` → Agent `diff`.

## On a run

Press **Run**. When the upstream agent finishes, this node pauses. The **Inbox** under the canvas lists it, and the second agent has not started. The card pill reads `waiting`.

**Approve** lets the diff continue to the next node. **Reject** needs a reason. That note is added to the upstream agent's prompt, and that agent runs again. Then the inbox asks once more. Three rejections can send the agent around again. The fourth rejection stops the branch. The approval card reads `failed`, and the error says the run stopped after 3 reject cycles.

When the upstream agent changed files, the inbox item lists those files and shows a side-by-side diff. The agent's private `agent-store` folder is left out of that list and is not committed. The left side is the worktree base. The right side is what the agent wrote, and you can edit it. **Approve** writes that right-hand text into the worktree, makes a normal git commit on the agent's branch, and passes those paths to the next node. The next agent's prompt includes the text you approved. **Reject** does not write the edited buffer. The worktree file stays as the agent left it.

The inbox line **Worktree** is the folder that commit lands in. Copy that path before you approve if you want to open the file afterwards. The folder stays on disk after the run so you can read the commit.

Quit the app while the inbox is waiting. Reopen it. The same item is still there, including the diff. Approve or reject from that item. There is no separate **Resume** button while an approval is waiting.

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
