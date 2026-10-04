import { useState, type FormEvent } from "react";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

export function RunLog() {
  const log = useRunStore((state) => state.log);
  const logsByNode = useRunStore((state) => state.logsByNode);
  const statusByNode = useRunStore((state) => state.statusByNode);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const selectedLog = selectedNodeId ? logsByNode[selectedNodeId] : undefined;
  const shown = selectedLog && selectedLog.length > 0 ? selectedLog : log;
  const workspacePath = useRunStore((state) => state.workspacePath);
  const budgetMessage = useRunStore((state) => state.budgetMessage);
  const steering = selectedNodeId !== null && statusByNode[selectedNodeId] === "running";
  const [draft, setDraft] = useState("");

  function submitSteer(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedNodeId) {
      return;
    }
    const text = draft;
    setDraft("");
    void useRunStore.getState().steer(selectedNodeId, text);
  }

  return (
    <section className="border-t border-zinc-800 px-4 py-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Run log</h2>
      {budgetMessage ? (
        <p data-testid="budget-message" className="mt-1 text-sm text-amber-300">
          {budgetMessage}
        </p>
      ) : null}
      {workspacePath ? (
        <p className="mt-1 font-mono text-xs text-zinc-400">
          Workspace <span data-testid="workspace-path">{workspacePath}</span>
        </p>
      ) : null}
      <pre
        data-testid="run-log"
        className="mt-1 max-h-28 overflow-auto font-mono text-xs whitespace-pre-wrap text-zinc-200"
      >
        {shown.length > 0 ? shown : "No run yet."}
      </pre>
      {steering && selectedNodeId ? (
        <form className="mt-2 flex gap-2" onSubmit={submitSteer}>
          <input
            data-testid="steer-input"
            value={draft}
            aria-label="Steer this agent"
            placeholder="Steer this agent"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-50"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <button
            type="submit"
            data-testid="steer-send"
            className="rounded border border-sky-700 px-3 py-1 text-sm hover:bg-sky-950"
          >
            Steer
          </button>
        </form>
      ) : null}
    </section>
  );
}
