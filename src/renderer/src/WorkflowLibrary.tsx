import { useEffect, useRef, useState, type ReactNode } from "react";
import { builtinTemplates, workflowFromTemplate, type BuiltinTemplate } from "@shared/templates";
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

function unusedName(summaries: readonly WorkflowSummary[], base = "Untitled"): string {
  const taken = new Set(summaries.map((item) => item.name));
  if (!taken.has(base)) {
    return base;
  }
  let n = 2;
  let name = `${base} ${n}`;
  while (taken.has(name)) {
    n += 1;
    name = `${base} ${n}`;
  }
  return name;
}

function parseEnvNames(value: string): string[] | undefined {
  const names = value.split(/[\s,]+/).filter((name) => name.length > 0);
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    return undefined;
  }
  return names;
}

function upsertSummary(current: readonly WorkflowSummary[], summary: WorkflowSummary): WorkflowSummary[] {
  const next = current.filter((item) => item.id !== summary.id);
  next.push(summary);
  next.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return next;
}

function RunWorkflowButton() {
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const running = useRunStore((state) => state.workflowRunning || state.activeNodeId !== null);
  const workflowRunning = useRunStore((state) => state.workflowRunning);
  const unfinishedThreadId = useRunStore((state) => state.unfinishedThreadId);
  const approvalsWaiting = useRunStore((state) => state.approvals.length > 0);

  useEffect(() => {
    void useRunStore.getState().refreshUnfinished(workflowId);
  }, [workflowId]);

  return (
    <>
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
      {workflowRunning ? (
        <button
          type="button"
          data-testid="cancel-workflow"
          className="rounded border border-amber-700 px-3 py-1.5 text-sm hover:bg-amber-950"
          onClick={() => {
            void useRunStore.getState().cancelWorkflow();
          }}
        >
          Cancel run
        </button>
      ) : null}
      {unfinishedThreadId && !running && !approvalsWaiting ? (
        <button
          type="button"
          data-testid="resume-workflow"
          className="rounded border border-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-950"
          onClick={() => {
            void useRunStore.getState().resume();
          }}
        >
          Resume
        </button>
      ) : null}
    </>
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
  const [picking, setPicking] = useState(false);
  const [pendingImport, setPendingImport] = useState<Workflow | null>(null);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
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

  async function createWorkflow(template: BuiltinTemplate | null): Promise<void> {
    setPicking(false);
    setBusy(true);
    setError("");
    try {
      await flushRef.current();
      const name = unusedName(summaries, template?.name ?? "Untitled");
      const workflow = template
        ? workflowFromTemplate(template, crypto.randomUUID(), name)
        : createEmptyWorkflow(name);
      const summary = await window.swarmy.workflows.save(workflow);
      useWorkflowStore.getState().replaceWorkflow(workflow);
      setSummaries((current) => upsertSummary(current, summary));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function exportWorkflow(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await flushRef.current();
      await window.swarmy.workflows.exportFile(useWorkflowStore.getState().workflow);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function importWorkflow(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await flushRef.current();
      const result = await window.swarmy.workflows.importFile();
      if (result.status === "cancelled") {
        return;
      }
      if (result.status === "needsSecrets") {
        setPendingImport(result.workflow);
        setSecretDrafts({});
        return;
      }
      useWorkflowStore.getState().replaceWorkflow(result.workflow);
      setSummaries((current) => upsertSummary(current, result.summary));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function commitImport(): Promise<void> {
    const workflow = pendingImport;
    if (!workflow) {
      return;
    }
    const required = workflow.requiredEnvVars ?? [];
    const secrets: Record<string, string> = {};
    for (const name of required) {
      const value = (secretDrafts[name] ?? "").trim();
      if (!value) {
        setError(`${name} is required`);
        return;
      }
      secrets[name] = value;
    }
    setBusy(true);
    setError("");
    try {
      const summary = await window.swarmy.workflows.commitImport(workflow, secrets);
      useWorkflowStore.getState().replaceWorkflow(workflow);
      setSummaries((current) => upsertSummary(current, summary));
      setPendingImport(null);
      setSecretDrafts({});
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
      <div className="flex min-h-0 flex-1 flex-col justify-center px-4" data-testid="workflow-editor">
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
    <div className="flex min-h-0 flex-1 flex-col" data-testid="workflow-editor">
      <WorkflowToolbar
        summaries={summaries}
        busy={busy}
        error={error}
        onCreate={() => {
          setPicking(true);
        }}
        onExport={() => {
          void exportWorkflow();
        }}
        onImport={() => {
          void importWorkflow();
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
      {picking ? (
        <TemplatePicker
          busy={busy}
          onCancel={() => {
            setPicking(false);
          }}
          onChoose={(template) => {
            void createWorkflow(template);
          }}
        />
      ) : null}
      {pendingImport ? (
        <ImportSecrets
          names={pendingImport.requiredEnvVars ?? []}
          drafts={secretDrafts}
          busy={busy}
          onChange={(name, value) => {
            setSecretDrafts((current) => ({ ...current, [name]: value }));
          }}
          onCancel={() => {
            setPendingImport(null);
            setSecretDrafts({});
          }}
          onSave={() => {
            void commitImport();
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

function TemplatePicker({
  busy,
  onCancel,
  onChoose,
}: {
  busy: boolean;
  onCancel: () => void;
  onChoose: (template: BuiltinTemplate | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" data-testid="template-picker">
      <div className="max-h-full w-96 overflow-auto rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-sm font-medium text-zinc-50">New workflow</h2>
        <p className="mt-1 text-sm text-zinc-400">Start blank, or start from a role.</p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            data-testid="template-blank"
            disabled={busy}
            className="rounded border border-zinc-600 px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:opacity-50"
            onClick={() => {
              onChoose(null);
            }}
          >
            Blank
          </button>
          {builtinTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              data-testid={`template-${template.id}`}
              disabled={busy}
              className="rounded border border-zinc-600 px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:opacity-50"
              onClick={() => {
                onChoose(template);
              }}
            >
              <span className="block font-medium text-zinc-50">{template.name}</span>
              <span className="block text-zinc-400">{template.summary}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="template-cancel"
          className="mt-3 rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ImportSecrets({
  names,
  drafts,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  names: readonly string[];
  drafts: Readonly<Record<string, string>>;
  busy: boolean;
  onChange: (name: string, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const ready = names.every((name) => (drafts[name] ?? "").trim().length > 0);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" data-testid="import-secrets">
      <div className="w-96 rounded border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-sm font-medium text-zinc-50">Values needed to import</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Enter each value. Swarmy stores it on this PC and keeps it out of the workflow.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {names.map((name) => (
            <label key={name} className="flex flex-col gap-1 text-sm text-zinc-300">
              {name}
              <input
                type="password"
                data-testid={`import-secret-${name}`}
                value={drafts[name] ?? ""}
                disabled={busy}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-50 disabled:opacity-50"
                onChange={(event) => {
                  onChange(name, event.target.value);
                }}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            data-testid="import-secrets-save"
            disabled={busy || !ready}
            className="rounded border border-sky-700 px-3 py-1.5 text-sm hover:bg-sky-950 disabled:opacity-50"
            onClick={onSave}
          >
            Save and import
          </button>
          <button
            type="button"
            data-testid="import-secrets-cancel"
            disabled={busy}
            className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function cleanDirectory(value: string): string {
  let directory = value.trim();
  while (directory.length > 3 && /[\\/]$/.test(directory)) {
    directory = directory.slice(0, -1);
  }
  return directory;
}

function TriggerControls({ busy }: { busy: boolean }) {
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const trigger = useWorkflowStore((state) => state.workflow.trigger);
  const [choice, setChoice] = useState({ id: workflowId, mode: trigger?.mode ?? "manual" });
  if (choice.id !== workflowId) {
    setChoice({ id: workflowId, mode: trigger?.mode ?? "manual" });
  }
  const mode = choice.id === workflowId ? choice.mode : (trigger?.mode ?? "manual");
  const savedMinutes = trigger?.mode === "interval" ? String(trigger.minutes) : "1";
  const [minutesDraft, setMinutesDraft] = useState({ id: workflowId, value: savedMinutes });
  if (minutesDraft.id !== workflowId) {
    setMinutesDraft({ id: workflowId, value: savedMinutes });
  }
  const minutesValue = minutesDraft.id === workflowId ? minutesDraft.value : savedMinutes;
  const savedDirectory = trigger?.mode === "watch" ? trigger.directory : "";
  const [directoryDraft, setDirectoryDraft] = useState({ id: workflowId, value: savedDirectory });
  if (directoryDraft.id !== workflowId) {
    setDirectoryDraft({ id: workflowId, value: savedDirectory });
  }
  const directoryValue = directoryDraft.id === workflowId ? directoryDraft.value : savedDirectory;
  const [skip, setSkip] = useState<{ id: string; path: string } | null>(null);

  useEffect(() => {
    return window.swarmy.runs.onTriggerSkip((event) => {
      if (event.workflowId !== useWorkflowStore.getState().workflow.id) {
        return;
      }
      setSkip({ id: event.workflowId, path: event.path });
    });
  }, []);

  function selectMode(next: "manual" | "interval" | "watch"): void {
    setChoice({ id: workflowId, mode: next });
    if (next === "manual") {
      useWorkflowStore.getState().setTrigger(null);
      return;
    }
    if (next === "interval") {
      const minutes = trigger?.mode === "interval" ? trigger.minutes : 1;
      setMinutesDraft({ id: workflowId, value: String(minutes) });
      useWorkflowStore.getState().setTrigger({ mode: "interval", minutes });
      return;
    }
    const directory = cleanDirectory(directoryValue);
    if (directory.length > 0) {
      useWorkflowStore.getState().setTrigger({ mode: "watch", directory });
      setDirectoryDraft({ id: workflowId, value: directory });
      return;
    }
    if (trigger?.mode !== "watch") {
      useWorkflowStore.getState().setTrigger(null);
    }
  }

  function commitMinutes(): void {
    const parsed = Number(minutesValue.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      const fallback = trigger?.mode === "interval" ? String(trigger.minutes) : "1";
      setMinutesDraft({ id: workflowId, value: fallback });
      return;
    }
    useWorkflowStore.getState().setTrigger({ mode: "interval", minutes: parsed });
    setMinutesDraft({ id: workflowId, value: String(parsed) });
  }

  function commitDirectory(): void {
    const directory = cleanDirectory(directoryValue);
    if (directory.length === 0) {
      setDirectoryDraft({ id: workflowId, value: savedDirectory });
      return;
    }
    useWorkflowStore.getState().setTrigger({ mode: "watch", directory });
    setDirectoryDraft({ id: workflowId, value: directory });
  }

  const skipText =
    skip && skip.id === workflowId
      ? skip.path.length > 0
        ? `Skipped ${fileName(skip.path)}: a run is already active.`
        : "Skipped a scheduled run: a run is already active."
      : "";

  return (
    <>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        Trigger
        <select
          data-testid="workflow-trigger"
          aria-label="Trigger"
          value={mode}
          disabled={busy}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
          onChange={(event) => {
            const next = event.target.value;
            if (next === "manual" || next === "interval" || next === "watch") {
              selectMode(next);
            }
          }}
        >
          <option value="manual">Manual</option>
          <option value="interval">Interval</option>
          <option value="watch">Watch folder</option>
        </select>
      </label>
      {mode === "interval" ? (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          Minutes
          <input
            data-testid="trigger-minutes"
            aria-label="Interval minutes"
            value={minutesValue}
            disabled={busy}
            className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
            onChange={(event) => {
              setMinutesDraft({ id: workflowId, value: event.target.value });
            }}
            onBlur={() => {
              commitMinutes();
            }}
          />
        </label>
      ) : null}
      {mode === "watch" ? (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          Folder
          <input
            data-testid="trigger-directory"
            aria-label="Watch folder"
            value={directoryValue}
            placeholder="Paste a folder path"
            disabled={busy}
            className="w-56 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
            onChange={(event) => {
              setDirectoryDraft({ id: workflowId, value: event.target.value });
            }}
            onBlur={() => {
              commitDirectory();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDirectory();
              }
            }}
          />
        </label>
      ) : null}
      <p data-testid="trigger-while-open" className="text-xs text-zinc-400">
        Triggers run only while Swarmy is open.
      </p>
      {skipText ? (
        <p data-testid="trigger-skipped" className="text-sm text-amber-200">
          {skipText}
        </p>
      ) : null}
    </>
  );
}

function WorkflowToolbar({
  summaries,
  busy,
  error,
  onCreate,
  onExport,
  onImport,
  onOpen,
  onDelete,
  onRename,
}: {
  summaries: readonly WorkflowSummary[];
  busy: boolean;
  error: string;
  onCreate: () => void;
  onExport: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const workflowName = useWorkflowStore((state) => state.workflow.name);
  const budgetTokens = useWorkflowStore((state) => state.workflow.budgetTokens);
  const requiredEnvVars = useWorkflowStore((state) => state.workflow.requiredEnvVars);
  const [budgetDraft, setBudgetDraft] = useState({
    id: workflowId,
    value: budgetTokens === undefined ? "" : String(budgetTokens),
  });
  if (budgetDraft.id !== workflowId) {
    setBudgetDraft({ id: workflowId, value: budgetTokens === undefined ? "" : String(budgetTokens) });
  }
  const budgetValue = budgetDraft.id === workflowId ? budgetDraft.value : budgetTokens === undefined ? "" : String(budgetTokens);
  const [envDraft, setEnvDraft] = useState({
    id: workflowId,
    value: requiredEnvVars?.join(", ") ?? "",
  });
  if (envDraft.id !== workflowId) {
    setEnvDraft({ id: workflowId, value: requiredEnvVars?.join(", ") ?? "" });
  }
  const envValue = envDraft.id === workflowId ? envDraft.value : (requiredEnvVars?.join(", ") ?? "");
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
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        Token budget
        <input
          data-testid="workflow-budget"
          aria-label="Token budget"
          value={budgetValue}
          placeholder="none"
          disabled={busy}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
          onChange={(event) => {
            setBudgetDraft({ id: workflowId, value: event.target.value });
          }}
          onBlur={() => {
            const trimmed = budgetValue.trim();
            if (trimmed.length === 0) {
              useWorkflowStore.getState().setBudget(null);
              setBudgetDraft({ id: workflowId, value: "" });
              return;
            }
            const parsed = Number(trimmed);
            if (!Number.isInteger(parsed) || parsed <= 0) {
              setBudgetDraft({ id: workflowId, value: budgetTokens === undefined ? "" : String(budgetTokens) });
              return;
            }
            useWorkflowStore.getState().setBudget(parsed);
            setBudgetDraft({ id: workflowId, value: String(parsed) });
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        Required env vars
        <input
          data-testid="required-env-vars"
          aria-label="Required env vars"
          value={envValue}
          placeholder="none"
          disabled={busy}
          className="w-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-50 disabled:opacity-50"
          onChange={(event) => {
            setEnvDraft({ id: workflowId, value: event.target.value });
          }}
          onBlur={() => {
            const names = parseEnvNames(envValue);
            if (!names) {
              setEnvDraft({ id: workflowId, value: requiredEnvVars?.join(", ") ?? "" });
              return;
            }
            useWorkflowStore.getState().setRequiredEnvVars(names);
            setEnvDraft({ id: workflowId, value: names.join(", ") });
          }}
        />
      </label>
      <TriggerControls busy={busy} />
      <RunWorkflowButton />
      <button
        type="button"
        data-testid="workflow-export"
        disabled={busy}
        className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
        onClick={onExport}
      >
        Export
      </button>
      <button
        type="button"
        data-testid="workflow-import"
        disabled={busy}
        className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
        onClick={onImport}
      >
        Import
      </button>
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
