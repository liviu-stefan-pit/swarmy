---
name: add-node-type
description: >-
  Registers a new Swarmy canvas node type: schema, handles, palette card,
  inspector section, a test, and a page under docs/nodes. Use when adding a
  node type, changing a handle, or changing what the user can do with a node.
---

# Add a node type

Do this in the phase that introduces the type. Do not add the type in an earlier phase. Decision D13: update `docs/nodes/` in the same change.

## Checklist

```text
- [ ] Schema branch in src/shared/workflow.ts
- [ ] Handles in src/shared/node-registry.ts (this is the palette card)
- [ ] Inspector section in src/renderer/src/NodeInspector.tsx
- [ ] A test that the type validates, plus a Playwright test if the canvas changes
- [ ] docs/nodes/<type>.md, and a row in README.md and handles.md
```

## Schema

Add the id to `nodeTypeIdSchema`. Add a `z.literal` branch on `workflowNodeSchema`.

Give the new type its own `data` object. Do not hang its fields on every node. Agent config stays on the `agent` branch.

An optional array that means "unset" must not use `.default([])`. An empty array and a missing field are different. For `tools`, `[]` means no built-in tools and a missing field means the SDK default toolset.

Edits from the inspector go through `updateSelectedNode` and must still parse with `workflowSchema`.

## Handles and palette

Add a `defineNode` in `src/shared/node-registry.ts`. The palette lists `nodeTypes`. Do not hard-code a second list in the renderer.

Handle data types stay in the D12 set: `text`, `file`, `folder`, `diff`, `mcp`. Handle id and data type are the same string today. An edge is valid only when both ends share that type. `connectError` is the check. Do not reimplement it in the component.

## Inspector

When that node is selected, `NodeInspector` shows its fields. Each control a test clicks gets a kebab-case `data-testid`.

A non-agent type shows its own fields. It does not show the agent prompt, tool, or workspace controls.

## Test

Add a unit test next to the schema or the store: the new type parses, or an illegal handle is rejected.

If the user can do something new on the canvas, add a Playwright test under `tests/e2e` that uses the test id. Automated tests use `FakeRuntime` and do not call the Cursor API.

## Docs

Add `docs/nodes/<type>.md`:

- What the node is for, in plain language.
- How to place it and which handles connect. Link the other node pages.
- The JSON shape this phase actually stores.
- A **Later** table for behavior that belongs to a later phase, marked with that phase number.

Add a row to the index in `docs/nodes/README.md` and to the handle tables in `docs/nodes/handles.md`. Write only what this phase ships.
