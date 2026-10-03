# Swarmy

Swarmy is a Windows desktop app for building and running swarms of Cursor agents. You design a workflow on a visual canvas, configure each agent, and the app runs them — with approval gates, live steering, isolated workspaces, and a shared task board.

The first version targets Windows only. The code is structured so macOS and Linux can be added later if they are actually needed.

## How this repo is built

Implementation is split into small phases. Each phase is one fresh Cursor chat, is test-driven (tests first, watch them fail, then write the code), and ends with something you can run yourself.

The living plan is [docs/PLAN.md](docs/PLAN.md). That file is the source of truth: what we are building, why earlier decisions were made, what each phase must deliver, and what changed along the way. Phase agents read it first and update it last.

### Start the next phase

1. Open [docs/PLAN.md](docs/PLAN.md) and find the first phase whose status is `[ ]`.
2. Open a **new** Cursor chat.
3. Paste the prompt from that phase's **Prompt** block.
4. When the agent finishes, run the **Manual test** steps yourself.
5. Tell the agent the result. It commits and tags `phase-NN` only after you confirm the test passed.

If you change the plan or the code between phases, write it in the **User Notes** section of `docs/PLAN.md`. The next agent is required to read that section and treat it as your instructions.

## Prerequisites

- Windows 10 or 11
- [Git](https://git-scm.com/)
- Node.js 22.13 or later (this machine has 24.19.0). `@cursor/sdk` will not run on older Node.
- A Cursor API key, from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations), once phases start talking to the Cursor SDK. Automated tests never spend API credits; they use a fake agent runtime.

`git config core.longpaths true` is set for this repo so deep `node_modules` trees do not hit the Windows path limit.

## Commands

These scripts exist after Phase 1:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Electron app |
| `npm run test` | Unit and component tests |
| `npm run test:e2e` | Playwright against the Electron app (fake runtime) |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck, lint, unit, and e2e |

## Research

Background research that informed the architecture lives in [docs/research](docs/research). Where those PDFs disagree with the current Cursor SDK docs, the SDK docs win. The decisions are recorded in `docs/PLAN.md`.
