---
name: start-phase
description: >-
  Starts a Swarmy implementation phase by reading docs/PLAN.md, detecting the
  user's manual edits, and writing failing tests before any production code.
  Use when the user pastes a phase prompt, says "start phase", "implement
  phase", or asks a new chat to continue Swarmy.
---

# Start phase

Do this before editing code. The phase number is the one in the user's message. If they did not name one, it is the first `[ ]` row in the status table of `docs/PLAN.md`.

## Checklist

```text
- [ ] Read docs/PLAN.md: status, User Notes, Decisions, the phase section
- [ ] Read the previous phase's completion notes
- [ ] Inspect git history since the previous phase tag
- [ ] Confirm the previous phase still passes (skip if there is no package.json)
- [ ] Post a short brief
- [ ] Write the phase's tests and show them failing
- [ ] Only then implement
```

## 1. Read the plan

Read `docs/PLAN.md` from the top through the current phase. Apply every **User Notes** row whose status is not `done`. Do not revert those changes.

If a note contradicts the phase, stop and ask. Do not guess.

## 2. Find what the user changed

From the repo root:

```powershell
git status --short
git log --oneline phase-00..HEAD
```

Use the previous phase tag instead of `phase-00` when it exists (`phase-01` before Phase 2, and so on). If the tag is missing, say so and use `git log --oneline`.

Treat commits and uncommitted edits you did not make in this chat as the user's. Summarize them in the brief. Do not overwrite them to "match the plan" unless a User Note says to.

## 3. Check the previous phase

If `package.json` exists and a `verify` script exists, run `npm run verify`. If it fails, fix the regression only if it is clearly caused by the user's edits being incomplete; otherwise stop and report the failure. Do not start the new phase on a red tree you did not just create.

## 4. Post the brief

Keep it short:

- Phase number and goal
- User Notes you will act on
- Manual changes you found
- Tests you are about to write
- Anything in scope you are unsure about (ask before coding if it changes the design)

## 5. Red, then green

Write the tests listed in the phase. Run them. Paste the failure. Then implement until they pass. Follow `.cursor/rules/01-tdd.mdc`.

Stay inside the phase's **Out of scope**. If you must deviate, append a Decision to `docs/PLAN.md` before writing the code.
