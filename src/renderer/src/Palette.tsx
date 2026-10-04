import { nodeTypes } from "@shared/node-registry";
import { CollapseControl, IconRail, NodesIcon, ResizeEdge } from "./PanelChrome";
import { usePanelLayoutStore } from "./panel-layout-store";

const nodeDragType = "application/swarmy-node";

export function Palette() {
  const paletteWidth = usePanelLayoutStore((state) => state.paletteWidth);
  const collapsed = usePanelLayoutStore((state) => state.paletteCollapsed);
  const togglePalette = usePanelLayoutStore((state) => state.togglePalette);

  if (collapsed) {
    return (
      <IconRail
        railTestId="node-palette"
        testId="collapse-palette"
        title="Nodes"
        border="right"
        icon={<NodesIcon />}
        onToggle={togglePalette}
      />
    );
  }

  return (
    <aside
      data-testid="node-palette"
      className="relative flex shrink-0 flex-col border-r border-zinc-800"
      style={{ width: paletteWidth }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Nodes</h2>
        <CollapseControl testId="collapse-palette" title="Nodes" collapsed={collapsed} onToggle={togglePalette} />
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto px-3 pb-3">
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
      </div>
      <ResizeEdge
        testId="resize-palette"
        edge="palette"
        orientation="vertical"
        label="Resize Nodes"
        className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-sky-600"
      />
    </aside>
  );
}
