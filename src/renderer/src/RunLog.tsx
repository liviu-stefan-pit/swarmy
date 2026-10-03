import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

export function RunLog() {
  const log = useRunStore((state) => state.log);
  const logsByNode = useRunStore((state) => state.logsByNode);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const selectedLog = selectedNodeId ? logsByNode[selectedNodeId] : undefined;
  const shown = selectedLog && selectedLog.length > 0 ? selectedLog : log;
  const workspacePath = useRunStore((state) => state.workspacePath);

  return (
    <section className="border-t border-zinc-800 px-4 py-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Run log</h2>
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
    </section>
  );
}
