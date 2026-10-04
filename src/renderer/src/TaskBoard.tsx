import { useEffect } from "react";
import { useRunStore } from "./run-store";

export function TaskBoard() {
  const tasks = useRunStore((state) => state.tasks);

  useEffect(() => {
    return window.swarmy.runs.onBoard((next) => {
      useRunStore.setState({ tasks: next });
    });
  }, []);

  return (
    <section data-testid="task-board" className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-2">
      {tasks.length === 0 ? (
        <p className="text-sm text-zinc-500">No tasks yet.</p>
      ) : (
        <ul className="space-y-1">
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
