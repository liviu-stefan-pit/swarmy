import type { ReactNode } from "react";
import { collapsedRailWidth, startPanelDrag } from "./panel-layout-store";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

export function NodesIcon() {
  return (
    <Glyph>
      <rect x="3" y="3" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </Glyph>
  );
}

export function InspectorIcon() {
  return (
    <Glyph>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 4v16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </Glyph>
  );
}

export function CollapseControl({
  testId,
  title,
  collapsed,
  onToggle,
}: {
  testId: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
      title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-sm text-zinc-300 hover:bg-zinc-800"
      onClick={onToggle}
    >
      <Glyph>
        {collapsed ? (
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        ) : (
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        )}
      </Glyph>
    </button>
  );
}

export function IconRail({
  railTestId,
  testId,
  title,
  border,
  icon,
  onToggle,
}: {
  railTestId: string;
  testId: string;
  title: string;
  border: "left" | "right";
  icon: ReactNode;
  onToggle: () => void;
}) {
  return (
    <aside
      data-testid={railTestId}
      className={`flex shrink-0 flex-col items-center py-2 ${border === "right" ? "border-r border-zinc-800" : "border-l border-zinc-800"}`}
      style={{ width: collapsedRailWidth }}
    >
      <button
        type="button"
        data-testid={testId}
        aria-expanded={false}
        aria-label={`Expand ${title}`}
        title={title}
        className="grid h-8 w-8 place-items-center rounded text-zinc-200 hover:bg-zinc-800"
        onClick={onToggle}
      >
        {icon}
      </button>
    </aside>
  );
}

export function ResizeEdge({
  testId,
  edge,
  orientation,
  label,
  className,
}: {
  testId: string;
  edge: "palette" | "inspector" | "bottom";
  orientation: "vertical" | "horizontal";
  label: string;
  className: string;
}) {
  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title={label}
      className={className}
      onPointerDown={(event) => {
        startPanelDrag(edge, event);
      }}
    />
  );
}
