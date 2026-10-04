import { useEffect, useState } from "react";
import type { RunCheckpoint, RunHistoryDetail, RunHistoryEntry } from "@shared/runs";
import { budgetExceededMessage } from "@shared/runs";
import { CollapseControl } from "./PanelChrome";
import { usePanelLayoutStore } from "./panel-layout-store";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

function errorText(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "Could not load run history";
  const wrapped = message.match(/^Error invoking remote method '[^']+': Error: ([\s\S]*)$/);
  return wrapped?.[1] ?? message;
}

function tokenLabel(nodes: RunHistoryDetail["nodes"]): string {
  const reported = nodes.flatMap((node) => (node.totalTokens === null ? [] : [node.totalTokens]));
  if (reported.length === 0) {
    return "tokens unavailable";
  }
  const total = reported.reduce((sum, value) => sum + value, 0);
  return total === 1 ? "1 token" : `${total} tokens`;
}

function costLabel(nodes: RunHistoryDetail["nodes"]): string {
  const known = nodes.filter((node) => node.costState === "known" && node.chargedCents !== null);
  if (known.length === 0) {
    return "cost pending";
  }
  const cents = known.reduce((sum, node) => sum + (node.chargedCents ?? 0), 0);
  const pending = nodes.some((node) => node.costState === "pending");
  const dollars = formatDollars(cents);
  return pending ? `${dollars}, cost pending` : dollars;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function runLabel(run: RunHistoryEntry): string {
  const when = new Date(run.startedAt).toLocaleString();
  const status = run.status === "budget_exceeded" ? "budget exceeded" : run.status;
  return `${when} · ${status}`;
}

function transcriptOf(detail: RunHistoryDetail): string {
  const text = detail.nodes
    .map((node) => (node.transcript.length > 0 ? `${node.nodeId}\n${node.transcript}` : node.nodeId))
    .join("\n\n");
  return text.length > 0 ? text : "No transcript stored.";
}

function checkpointWhen(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return time;
  }
  return date.toLocaleString();
}

export function RunHistory() {
  const workflow = useWorkflowStore((state) => state.workflow);
  const historyRevision = useRunStore((state) => state.historyRevision);
  const [runs, setRuns] = useState<RunHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<RunHistoryDetail | undefined>();
  const [checkpoints, setCheckpoints] = useState<RunCheckpoint[]>([]);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.swarmy.runs
      .history(workflow.id)
      .then((listed) => {
        if (cancelled) {
          return;
        }
        setRuns(listed);
        setSelectedId("");
        setDetail(undefined);
        setCheckpoints([]);
        setSelectedCheckpoint("");
        setError("");
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(errorText(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [historyRevision, workflow.id]);

  async function openRun(threadId: string): Promise<void> {
    setSelectedId(threadId);
    setCheckpoints([]);
    setSelectedCheckpoint("");
    if (threadId.length === 0) {
      setDetail(undefined);
      return;
    }
    try {
      const [opened, listed] = await Promise.all([
        window.swarmy.runs.openHistory(threadId),
        window.swarmy.runs.checkpoints(workflow, threadId),
      ]);
      setDetail(opened);
      setCheckpoints(listed);
      setError("");
    } catch (caught) {
      setDetail(undefined);
      setCheckpoints([]);
      setError(errorText(caught));
    }
  }

  async function refreshCost(): Promise<void> {
    if (selectedId.length === 0) {
      return;
    }
    setRefreshing(true);
    try {
      setDetail(await window.swarmy.runs.refreshHistory(selectedId));
      setError("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRefreshing(false);
    }
  }

  async function forkSelected(): Promise<void> {
    if (selectedId.length === 0 || selectedCheckpoint.length === 0) {
      return;
    }
    setForking(true);
    try {
      await useRunStore.getState().forkCheckpoint(selectedId, selectedCheckpoint);
      setError("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setForking(false);
    }
  }

  const lastCheckpoint = checkpoints[checkpoints.length - 1]?.checkpointId ?? "";
  const selected = checkpoints.find((checkpoint) => checkpoint.checkpointId === selectedCheckpoint);
  const canFork = selectedCheckpoint.length > 0 && selectedCheckpoint !== lastCheckpoint && !forking;

  const collapsed = usePanelLayoutStore((state) => state.historyCollapsed);
  const toggleHistory = usePanelLayoutStore((state) => state.toggleHistory);

  return (
    <section className="border-t border-zinc-800 px-4 py-2" data-testid="run-history">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">History</h2>
          {collapsed ? null : (
            <>
              <select
                data-testid="run-history-list"
                aria-label="Run history"
                value={selectedId}
                className="max-w-md rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-50"
                onChange={(event) => {
                  void openRun(event.target.value);
                }}
              >
                <option value="">{runs.length === 0 ? "No past runs" : "Open a past run"}</option>
                {runs.map((run) => (
                  <option key={run.threadId} value={run.threadId}>
                    {runLabel(run)}
                  </option>
                ))}
              </select>
              {selectedId.length > 0 ? (
                <button
                  type="button"
                  data-testid="run-history-refresh"
                  disabled={refreshing}
                  className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800 disabled:opacity-50"
                  onClick={() => {
                    void refreshCost();
                  }}
                >
                  Refresh cost
                </button>
              ) : null}
            </>
          )}
        </div>
        <CollapseControl
          testId="collapse-history"
          title="Run history"
          collapsed={collapsed}
          onToggle={toggleHistory}
        />
      </div>
      {collapsed ? null : (
        <>
          {error ? <p className="mt-1 text-sm text-red-300">{error}</p> : null}
          {checkpoints.length > 0 ? (
            <div className="mt-2 space-y-2">
              <ol data-testid="checkpoint-timeline" className="flex flex-wrap gap-2">
                {checkpoints.map((checkpoint) => (
                  <li key={checkpoint.checkpointId}>
                    <button
                      type="button"
                      data-testid="checkpoint"
                      aria-pressed={checkpoint.checkpointId === selectedCheckpoint}
                      className={`rounded border px-2 py-1 text-left text-sm ${
                        checkpoint.checkpointId === selectedCheckpoint
                          ? "border-sky-500 bg-sky-950 text-sky-100"
                          : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                      }`}
                      onClick={() => {
                        setSelectedCheckpoint(checkpoint.checkpointId);
                      }}
                    >
                      <span className="block font-medium">{checkpoint.label}</span>
                      <span className="block text-xs text-zinc-400">{checkpointWhen(checkpoint.time)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {selected?.workspacePath ? (
                <p className="text-xs text-zinc-400">
                  Worktree <span data-testid="checkpoint-worktree">{selected.workspacePath}</span>
                </p>
              ) : null}
              <button
                type="button"
                data-testid="fork-checkpoint"
                disabled={!canFork}
                className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800 disabled:opacity-50"
                onClick={() => {
                  void forkSelected();
                }}
              >
                Fork
              </button>
            </div>
          ) : null}
          {detail ? (
            <div className="mt-2 space-y-1">
              {detail.status === "budget_exceeded" ? (
                <p className="text-sm text-amber-300">{budgetExceededMessage}</p>
              ) : null}
              <p data-testid="run-history-tokens" className="text-sm text-zinc-200">
                {tokenLabel(detail.nodes)}
              </p>
              <p data-testid="run-history-cost" className="text-sm text-zinc-200">
                {costLabel(detail.nodes)}
              </p>
              <pre
                data-testid="run-history-log"
                className="max-h-28 overflow-auto font-mono text-xs whitespace-pre-wrap text-zinc-200"
              >
                {transcriptOf(detail)}
              </pre>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
