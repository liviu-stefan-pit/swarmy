# Planner

Palette label: **Planner**. Type id: `planner`.

A Planner splits one goal into tasks, then the engine starts one worker for each task. Those workers are not nodes you draw, and they are not saved in the workflow.

## On the canvas

Drag **Planner** onto the canvas. It has one blue input and one blue output, both `text`, and a **Delete** button that removes this node and any wires attached to it.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `text` | input | `text` | [Text](text-input.md), [Agent](agent.md), another Planner, or [Merge](merge.md) |
| `text` | output | `text` | Agent, another Planner, or Merge |

It does not take a file, a folder, an MCP server, or a diff. It does not produce a diff.

Click the card. The inspector has **Goal**, **Model**, and **Workspace mode**. **Goal** is the brief the planner splits. **Not set** means each worker gets its own managed folder. `repo` uses the workflow repository, and each worker gets its own worktree. `folder` uses the folder you type.

**Run** in the toolbar starts the planner. It can read files. It cannot write them. It must call `submit_plan` with `{ tasks: [{ id, title, prompt }] }`. A plan can have at most 8 tasks. A ninth task is rejected, and the planner is told once. If it never calls `submit_plan`, the card fails and no workers start.

Each accepted task becomes a row under the Planner card for this run. The row shows the task title and its status. A long title is cut off so the card keeps a fixed width. Hover a row to see that worker's folder. The same folder is written in the run log. Those rows are not saved in the workflow, and they are not cards you can wire.

Each worker's prompt is its task prompt plus the plan summary. Workers can write files. They do not share one folder unless you set **Workspace mode** to `folder`.

## Schema

```json
{
  "id": "split",
  "type": "planner",
  "position": { "x": 280, "y": 0 },
  "data": {
    "label": "Planner",
    "taskPrompt": "List two independent one-line text files to create",
    "workspaceMode": "managed"
  }
}
```

| Field | Rule |
| --- | --- |
| `label` | Non-empty string shown on the card |
| `taskPrompt` | Optional goal. The planner turns this into at most 8 tasks |
| `modelId` | Optional model id. Omitted uses the same default as an agent |
| `systemPrompt` | Optional extra instructions. The planner is still told to plan only |
| `workspaceMode` | Optional `repo`, `managed`, or `folder`. Omitted means `managed` for the planner and for each worker |
| `folderPath` | Required for a run when `workspaceMode` is `folder` |

Worker rows are not stored on the node.

| Handle | Direction | Type |
| --- | --- | --- |
| `text` | input | `text` |
| `text` | output | `text` |
