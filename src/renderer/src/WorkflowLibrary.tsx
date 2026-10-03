import { useEffect, useRef, useState, type ReactNode } from "react";
import { workflowSchema, type Workflow } from "@shared/workflow";
import type { WorkflowSummary } from "@shared/workflows";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

const autosaveDelayMs = 400;

type LoadedLibrary = {
  workflow: Workflow;
  summaries: WorkflowSummary[];
};

let opening: Promise<LoadedLibrary> | undefined;

function openLibrary(): Promise<LoadedLibrary> {
  opening ??= loadLibrary().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

async function loadLibrary(): Promise<LoadedLibrary> {
  const summaries = await window.swarmy.workflows.list();
  const latest = summaries[0];
  if (!latest) {
    const workflow = createEmptyWorkflow("Untitled");
    const summary = await window.swarmy.workflows.save(workflow);
    return { workflow, summaries: [summary] };
  }
  const workflow = await window.swarmy.workflows.load(latest.id);
  return { workflow, summaries };
}

function createEmptyWorkflow(name: string): Workflow {
  return workflowSchema.parse({
    id: crypto.randomUUID(),
    name,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  });
}

function unusedName(summaries: readonly WorkflowSummary[]): string {
  const taken = new Set(summaries.map((item) => item.name));
  if (!taken.has("Untitled")) {
    return "Untitled";
  }
  let n = 2;
  let name = `Untitled ${n}`;
  while (taken.has(name)) {
    n += 1;
    name = `Untitled ${n}`;
  }
  return name;
}

function upsertSummary(current: readonly WorkflowSummary[], summary: WorkflowSummary): WorkflowSummary[] {
  const next = current.filter((item) => item.id !== summary.id);
  next.push(summary);
  next.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return next;
}

function RunWorkflowButton() {
  const running = useRunStore((state) => state.workflowRunning || state.activeNodeId !== null);
  return (
    <button
      type="button"
      data-testid="run-workflow"
      disabled={running}
      className="rounded border border-sky-700 px-3 py-1.5 text-sm hover:bg-sky-950 disabled:opacity-50"
      onClick={() => {
        void useRunStore.getState().startWorkflow();
      }}
    >
      Run
    </button>
  );
}

function errorText(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "The request failed";
  const wrapped = message.match(/^Error invoking remote method '[^']+': Error: ([\s\S]*)$/);
  return wrapped?.[1] ?? message;
}

export function WorkflowLibrary({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [summaries, setSummaries] = useState<WorkflowSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const discardRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    let cancelled = false;
    let started = false;
    const stop = window.swarmy.engine.onStatus((status) => {
      if (status !== "connected" || started) {
        return;
      }
      started = true;
      void openLibrary()
        .then((loaded) => {
          if (cancelled) {
            return;
          }
          useWorkflowStore.getState().replaceWorkflow(loaded.workflow);
          setSummaries(loaded.summaries);
          setReady(true);
        })
        .catch((caught: unknown) => {
          started = false;
          if (!cancelled) {
            setError(errorText(caught));
          }
        });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Workflow | undefined;
    let generation = 0;
    let chain = Promise.resolve();

    const discard = (): Promise<void> => {
      generation += 1;
      pending = undefined;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      return chain;
    };

    const flush = (): Promise<void> => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      const workflow = pending;
      const stamp = generation;
      pending = undefined;
      if (!workflow) {
        return chain;
      }
      chain = chain.then(async () => {
        if (stamp !== generation) {
          return;
        }
        try {
          const summary = await window.swarmy.workflows.save(workflow);
          if (stamp !== generation) {
            return;
          }
          setSummaries((current) => upsertSummary(current, summary));
          setError("");
        } catch (caught) {
          if (stamp === generation) {
            setError(errorText(caught));
          }
        }
      });
      return chain;
    };

    flushRef.current = flush;
    discardRef.current = discard;
    window.__swarmyFlushWorkflow = () => flush();

    const unsubscribe = useWorkflowStore.subscribe((state, previous) => {
      if (state.workflow === previous.workflow) {
        return;
      }
      pending = state.workflow;
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void flush();
      }, autosaveDelayMs);
    });

    return () => {
      unsubscribe();
      generation += 1;
      if (timer) {
        clearTimeout(timer);
      }
      flushRef.current = async () => undefined;
      discardRef.current = async () => undefined;
      delete window.__swarmyFlushWorkflow;
    };
  }, [ready]);

  async function createWorkflow(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await flushRef.current();
      const workflow = createEmptyWorkflow(unusedName(summaries));
      const summary = await window.swarmy.workflows.save(workflow);
      useWorkflowStore.getState().replaceWorkflow(workflow);
      setSummaries((current) => upsertSummary(current, summary));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openWorkflow(id: string): Promise<void> {
    if (id === useWorkflowStore.getState().workflow.id) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await flushRef.current();
      const workflow = await window.swarmy.workflows.load(id);
      useWorkflowStore.getState().replaceWorkflow(workflow);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkflow(): Promise<void> {
    const currentId = useWorkflowStore.getState().workflow.id;
    setBusy(true);
    setError("");
    try {
      await discardRef.current();
      await window.swarmy.workflows.delete(currentId);
      const rest = summaries.filter((item) => item.id !== currentId);
      const next = rest[0];
      if (next) {
        const workflow = await window.swarmy.workflows.load(next.id);
        useWorkflowStore.getState().replaceWorkflow(workflow);
        setSummaries(rest);
      } else {
        const workflow = createEmptyWorkflow("Untitled");
        const summary = await window.swarmy.workflows.save(workflow);
        useWorkflowStore.getState().replaceWorkflow(workflow);
        setSummaries([summary]);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center px-4">
        {error ? (
          <p data-testid="workflow-error" className="text-sm text-red-300">
            {error}
          </p>
        ) : (
          <p data-testid="workflow-loading" className="text-sm text-zinc-400">
            Loading workflow…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowToolbar
        summaries={summaries}
        busy={busy}
        error={error}
        onCreate={() => {
          void createWorkflow();
        }}
        onOpen={(id) => {
          void openWorkflow(id);
        }}
        onDelete={() => {
          void deleteWorkflow();
        }}
        onRename={(name) => {
          const id = useWorkflowStore.getState().workflow.id;
          useWorkflowStore.getState().renameWorkflow(name);
          setSummaries((current) => current.map((item) => (item.id === id ? { ...item, name } : item)));
        }}
      />
      {children}
    </div>
  );
}

function WorkflowToolbar({
  summaries,
  busy,
  error,
  onCreate,
  onOpen,
  onDelete,
  onRename,
}: {
  summaries: readonly WorkflowSummary[];
  busy: boolean;
  error: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const workflowName = useWorkflowStore((state) => state.workflow.name);
  const [draftState, setDraftState] = useState({ id: workflowId, value: workflowName });
  if (draftState.id !== workflowId) {
    setDraftState({ id: workflowId, value: workflowName });
  }
  const draft = draftState.id === workflowId ? draftState.value : workflowName;
  const options = summaries.some((item) => item.id === workflowId)
    ? summaries
    : [{ id: workflowId, name: workflowName, createdAt: 0, updatedAt: 0 }, ...summaries];

  function commitName(value: string): void {
    if (value.length === 0 || value === workflowName) {
      return;
    }
    onRename(value);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
      <button
        type="button"
        data-testid="workflow-new"
        disabled={busy}
        className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
        onClick={onCreate}
      >
        New
      </button>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        Name
        <input
          data-testid="workflow-name"
          value={draft}
          disabled={busy}
          className="w-56 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
          onChange={(event) => {
            const next = event.target.value;
            setDraftState({ id: workflowId, value: next });
            commitName(next);
          }}
          onBlur={() => {
            if (draft.length === 0) {
              setDraftState({ id: workflowId, value: workflowName });
            }
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        Workflows
        <select
          data-testid="workflow-list"
          aria-label="Workflows"
          value={workflowId}
          disabled={busy}
          className="max-w-xs rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
          onChange={(event) => {
            onOpen(event.target.value);
          }}
        >
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id === workflowId ? draft || item.name : item.name}
            </option>
          ))}
        </select>
      </label>
      <RunWorkflowButton />
      <button
        type="button"
        data-testid="workflow-delete"
        disabled={busy}
        className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
        onClick={onDelete}
      >
        Delete
      </button>
      {error ? (
        <p data-testid="workflow-error" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
