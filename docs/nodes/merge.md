# Merge

Palette label: **Merge**. Type id: `merge`.

A Merge node brings upstream agent branches back together. It merges those branches, one at a time, into a target branch. The default target is `main`.

On the canvas this is also a join in the graph. Text and diff handles still only connect to the same type. The git merge uses the upstream agents' repo branches, not the text that travels on the wire.

## On the canvas

Drag **Merge** onto the canvas. **Delete** on the card removes this node and any wires attached to it. There is no **Run** button on the card. The pill shows `idle`, `running`, `waiting`, `completed`, `failed`, or `cancelled`.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `text` | input | `text` | [Text](text-input.md), [Agent](agent.md), [Planner](planner.md), or another Merge |
| `diff` | input | `diff` | Agent, [Approval](approval.md), or another Merge |
| `text` | output | `text` | Agent, Planner, or another Merge |
| `diff` | output | `diff` | Approval, or another Merge |

Text and diff stay separate. An Agent `text` output goes to the Merge `text` input. An Agent `diff` output goes to the Merge `diff` input. Crossing those is refused.

Two Agents can both wire their text outputs into the same Merge `text` input. Connect them in the order they should merge. The first edge is the first branch.

Click the card. The inspector has **Label** and **Target branch**. Leave **Target branch** as `main`, or type another branch that already exists in the clone.

The agents that feed the merge need **Workspace mode** `repo`, and the workflow **Repository** must be the git clone. Each of those agents has its own worktree and `swarm/…` branch. A workflow run leaves those worktrees on disk. Merge commits any uncommitted edits in an upstream worktree onto that agent's branch, then merges the branch.

The clone itself must have a clean working tree. If it is not already on the target branch, Swarmy checks that branch out before merging.

## On a run

Press **Run** in the toolbar. After the upstream agents finish, Merge takes their branches in edge order.

A clean step fast-forwards or creates a merge commit on the target. The node's handoff summary is `Merged into <branch> at <sha>.` Downstream prompts include that summary, so they can see the commit.

A conflict stops the sequence. Nothing after that branch is merged. Swarmy does not pick a side, and it does not leave conflict markers on the target branch. The **Inbox** lists the merge. The summary starts with `Merge conflict`. The conflicted files are shown side by side, including a `|||||||` ancestor marker when the merge used the diff3 form. The merge pill reads `waiting`.

**Approve** writes the right-hand text only when those markers are gone. If the text still contains `<<<<<<<`, `|||||||`, `=======`, or `>>>>>>>` at the start of a line, the merge fails with `The conflict is still unresolved.` **Reject** needs a reason and fails the merge. It does not guess a resolution.

## Schema

```json
{
  "id": "combine",
  "type": "merge",
  "position": { "x": 560, "y": 160 },
  "data": { "label": "Combine", "targetBranch": "main" }
}
```

Omitting `targetBranch` means `main`.

| Handle | Direction | Type |
| --- | --- | --- |
| `text` | input | `text` |
| `diff` | input | `diff` |
| `text` | output | `text` |
| `diff` | output | `diff` |
