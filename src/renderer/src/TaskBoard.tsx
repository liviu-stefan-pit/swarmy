import { useEffect } from "react";
import { CollapseControl } from "./PanelChrome";
import { usePanelLayoutStore } from "./panel-layout-store";
import { useRunStore } from "./run-store";

export function TaskBoard() {
  const tasks = useRunStore((state) => state.tasks);
  const collapsed = usePanelLayoutStore((state) => state.boardCollapsed);
  const toggleBoard = usePanelLayoutStore((state) => state.toggleBoard);

  useEffect(() => {
    return window.swarmy.runs.onBoard((next) => {
      useRunStore.setState({ tasks: next });
    });
  }, []);

  return (
    <section data-testid="task-board" className="border-t border-zinc-800 px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Board</h2>
        <CollapseControl testId="collapse-board" title="Board" collapsed={collapsed} onToggle={toggleBoard} />
      </div>
      {collapsed ? null : tasks.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-500">No tasks yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {tasks.map((task) => (
            <li
              key={task.id}
              data-testid="task-row"
              className="grid grid-cols-[minmax(0,8rem)_minmax(0,8rem)_minmax(0,6rem)_1fr] gap-3 text-sm text-zinc-200"
            >
              <span className="truncate font-mono">{task.id}</span>
              <span className="truncate">{task.owner}</span>
              <span className="truncate">{task.status}</span>
              <span className="truncate">{task.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
