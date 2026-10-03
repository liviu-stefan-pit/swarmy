# Merge

Palette label: **Merge**. Type id: `merge`.

A Merge node is where parallel branches meet. It accepts text or diffs from upstream and can pass either kind on.

On the canvas this is a join in the graph. The git merge, the one that combines agent branches into a target branch, is Phase 19.

## On the canvas

Drag **Merge** onto the canvas.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `text` | input | `text` | [Text](text-input.md), [Agent](agent.md), [Planner](planner.md), or another Merge |
| `diff` | input | `diff` | Agent, [Approval](approval.md), or another Merge |
| `text` | output | `text` | Agent, Planner, or another Merge |
| `diff` | output | `diff` | Approval, or another Merge |

Text and diff stay separate. An Agent `text` output goes to the Merge `text` input. An Agent `diff` output goes to the Merge `diff` input. Crossing those is refused.

Two Agents can both wire their text outputs into the same Merge `text` input. That is the sink of a diamond: one source, two middle nodes, one Merge. See [the index](README.md).

## Later

Phase 19 merges the upstream branches one at a time into a target branch (default `main`). A conflict stops for review. It does not guess a resolution. Until then, Merge only records the join in the document.

## Schema

```json
{
  "id": "combine",
  "type": "merge",
  "position": { "x": 560, "y": 160 },
  "data": { "label": "Combine" }
}
```

| Handle | Direction | Type |
| --- | --- | --- |
| `text` | input | `text` |
| `diff` | input | `diff` |
| `text` | output | `text` |
| `diff` | output | `diff` |
