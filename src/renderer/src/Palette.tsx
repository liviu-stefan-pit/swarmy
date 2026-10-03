import { nodeTypes } from "@shared/node-registry";

const nodeDragType = "application/swarmy-node";

export function Palette() {
  return (
    <aside
      data-testid="node-palette"
      className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r border-zinc-800 p-3"
    >
      <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Nodes</h2>
      {nodeTypes.map((nodeType) => (
        <button
          key={nodeType.type}
          type="button"
          draggable
          data-testid={`palette-${nodeType.type}`}
          title={nodeType.description}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm font-medium select-none hover:border-zinc-500"
          onDragStart={(event) => {
            event.dataTransfer.setData(nodeDragType, nodeType.type);
            event.dataTransfer.effectAllowed = "move";
          }}
        >
          {nodeType.label}
        </button>
      ))}
    </aside>
  );
}
