# Agent

Palette label: **Agent**. Type id: `agent`.

An Agent is a Cursor agent. It is the worker in the swarm. It can read text, a file, a folder, and MCP servers. It produces a reply and a diff.

## On the canvas

Drag **Agent** onto the canvas. The card shows the label, a status pill, **Run**, and **Cancel**. The pill reads `idle` until you run the node. A run moves it through `running`, then `completed`, `failed`, or `cancelled`.

**Run** sends that agent's task prompt to one Cursor agent. The reply streams into the **Run log** under the canvas. **Cancel** stops the run that is in progress. Only one agent runs at a time. Steering text is not on the card yet.

The run uses the workspace mode on this agent. While it runs, the **Run log** shows the workspace path. After the run finishes, Swarmy deletes a `repo` worktree or a `managed` folder. A `folder` path is left in place.

Select the card. The inspector on the right edits that agent only:

| Field | What you set |
| --- | --- |
| Label | The name on the card |
| Model | A model id, as text. The live catalog is not in this list yet |
| System prompt | Instructions for the agent |
| Task prompt | The task for this node |
| Template variables | Every `{{name}}` token in the two prompts. The list is not filled from upstream nodes yet |
| Tools | **Default** leaves the field off, which means the SDK's default toolset. **Only these** stores an allow list. An empty list means no built-in tools |
| Disallowed tools | Same two choices for the deny list |
| Workspace mode | `repo`, `managed`, or `folder`. Leave it unset and the run uses `managed` |
| Repository | Shown when the mode is `repo`. The git clone for this workflow. Every repo agent shares it |
| Folder | Shown when the mode is `folder`. The plain folder this agent writes in. Only one run may use it at a time |

A second agent keeps its own prompts. Editing one does not copy them onto the other.

Choose `repo` and the inspector shows **Repository**. That path is a git clone stored on the workflow, so every repo agent in the workflow shares it. Swarmy adds a worktree under `%LOCALAPPDATA%\Swarmy\wt\<id>` on branch `swarm/<id>`. The worktree is not the clone's main folder. `managed` creates `%LOCALAPPDATA%\Swarmy\managed\<id>` and runs `git init` there. `folder` uses the folder you typed.

Inputs are on the left. Outputs are on the right.

| Handle | Direction | Type | Connect it to |
| --- | --- | --- | --- |
| `text` | input | `text` | [Text](text-input.md), another Agent, [Planner](planner.md), or [Merge](merge.md) |
| `file` | input | `file` | [File](file-input.md) |
| `folder` | input | `folder` | [Folder](folder-input.md) |
| `mcp` | input | `mcp` | [MCP](mcp.md) |
| `text` | output | `text` | another Agent, Planner, or Merge |
| `diff` | output | `diff` | [Approval](approval.md) or Merge |

The `diff` output cannot land on the `file` input. Those types differ, and the canvas refuses the edge. `examples/bad-handle.json` is that mistake.

Several sources may share one input. A Text node and a Planner may both wire into the same Agent `text` handle.

## Later

| Phase | What arrives |
| --- | --- |
| 10 | The whole graph runs, and this node's text and diff are the handoff |
| 14 | Tool limits and a hook that blocks dangerous shell commands |

## Schema

```json
{
  "id": "writer",
  "type": "agent",
  "position": { "x": 280, "y": 40 },
  "data": {
    "label": "Writer",
    "modelId": "composer-2.5",
    "systemPrompt": "You write the change. Use {{goal}}.",
    "taskPrompt": "Implement {{goal}}.",
    "tools": [],
    "disallowedTools": ["Shell"],
    "workspaceMode": "repo"
  }
}
```

`label` is required. The other fields are optional. `folderPath` is the folder used when `workspaceMode` is `folder`. The git clone for `repo` mode is `repositoryPath` on the workflow, not on this node.

`tools: []` means no built-in tools. Leaving `tools` out means the default toolset. Those are not the same, and saving the node does not turn one into the other. `disallowedTools` works the same way.

`{{goal}}` in the prompts shows up in the inspector as a template variable. The name is not stored on its own, and nothing fills it from an upstream node yet.
