---
name: finish-phase
description: >-
  Finishes a Swarmy phase by running npm run verify, updating docs/PLAN.md,
  and committing plus tagging only after the user confirms the manual test.
  Use when a phase's implementation is done, the user says the manual test
  passed or failed, or the user asks to close, tag, or commit a phase.
---

# Finish phase

## When implementation is done, before the user has tested

1. Run `npm run verify` if the script exists. Fix failures. Do not delete tests to get there.
2. Update `docs/PLAN.md`:
   - Set this phase's status to `[~]` until the user confirms. Do not mark `[x]` yet.
   - Fill **Completion notes**: what landed, deviations and the Decision id, follow-ups, and the outcomes the phase asked you to record (for example the SQLite spike).
   - If a later phase's prompt or scope is now wrong because of a deviation, edit that section and say why in the notes.
   - Mark **User Notes** you fully addressed as `done`, with one line on what changed.
   - If this phase added a node type, changed a handle, or changed what the user can do with a node, update `docs/nodes/` (decision D13): the index, `handles.md`, and that node's page.
3. Reply with the phase's **Manual test** steps, copied from the plan, and stop. Do not commit.

## When the user says the manual test failed

Fix the cause, re-run verify, and send the manual steps again. Do not commit.

## When the user says the manual test passed

1. Set the phase status to `[x]`, and fill the Tag (`phase-NN`) and Date columns.
2. Commit, then tag. Do not push unless the user asked.

Commit subject: `phase-NN: <what a reviewer sees>`.

Tag: `phase-NN` on that commit. PowerShell has no heredoc, so run the commit through Git Bash. Do not commit secrets (`.env`, API keys, `*.db`).

```bash
git add -A
git commit -m "$(cat <<'EOF'
phase-NN: short summary

EOF
)"
git tag phase-NN
```

3. Tell the user the tag, and paste the **Prompt** block for the next phase so they can drop it into a new chat.
