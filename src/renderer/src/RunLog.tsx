import { useRunStore } from "./run-store";

export function RunLog() {
  const log = useRunStore((state) => state.log);

  return (
    <section className="border-t border-zinc-800 px-4 py-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Run log</h2>
      <pre
        data-testid="run-log"
        className="mt-1 max-h-28 overflow-auto font-mono text-xs whitespace-pre-wrap text-zinc-200"
      >
        {log.length > 0 ? log : "No run yet."}
      </pre>
    </section>
  );
}
