import { useRunStore } from "./run-store";

export function RunLog() {
  const log = useRunStore((state) => state.log);
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
        {log.length > 0 ? log : "No run yet."}
      </pre>
    </section>
  );
}
