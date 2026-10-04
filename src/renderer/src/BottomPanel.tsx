import { useEffect, useRef, type ReactNode } from "react";
import { ApprovalInbox } from "./ApprovalInbox";
import { CollapseControl, ResizeEdge } from "./PanelChrome";
import { displayedBottomHeight, maxBottomHeight, usePanelLayoutStore, type BottomView } from "./panel-layout-store";
import { RunHistory } from "./RunHistory";
import { RunLog } from "./RunLog";
import { useRunStore } from "./run-store";
import { TaskBoard } from "./TaskBoard";

const fallbackChrome = 50;

const tabs: { id: BottomView; testId: string; label: string }[] = [
  { id: "board", testId: "bottom-tab-board", label: "Board" },
  { id: "inbox", testId: "bottom-tab-inbox", label: "Inbox" },
  { id: "history", testId: "bottom-tab-history", label: "History" },
  { id: "log", testId: "bottom-tab-log", label: "Run log" },
];

export function BottomPanel() {
  const layout = usePanelLayoutStore();
  const approvals = useRunStore((state) => state.approvals);
  const displayed = displayedBottomHeight(layout);
  const seenApprovals = useRef(new Set<string>());
  const bodyHeight = displayed === undefined ? undefined : Math.max(0, displayed - fallbackChrome);

  useEffect(() => {
    const fit = () => {
      const state = usePanelLayoutStore.getState();
      const maxStored = maxBottomHeight();
      const shown = displayedBottomHeight(state);
      if (shown !== undefined && shown > maxStored) {
        state.setBottomHeight(maxStored);
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const ids = new Set(approvals.map((item) => item.nodeId));
    let fresh = false;
    for (const id of ids) {
      if (!seenApprovals.current.has(id)) {
        fresh = true;
        break;
      }
    }
    seenApprovals.current = ids;
    if (fresh) {
      usePanelLayoutStore.getState().openReview();
    }
  }, [approvals]);

  return (
    <div
      data-testid="bottom-stack"
      className="flex shrink-0 flex-col"
      style={displayed === undefined ? undefined : { height: displayed }}
    >
      <div className="shrink-0">
        <ResizeEdge
          testId="resize-bottom"
          edge="bottom"
          orientation="horizontal"
          label="Resize panels under the canvas"
          className="h-2.5 shrink-0 cursor-row-resize border-t border-zinc-800 bg-zinc-900 hover:bg-sky-700"
        />
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-2">
        <div role="tablist" aria-label="Panels under the canvas" className="flex min-w-0 gap-1">
          {tabs.map((tab) => {
            const selected = layout.bottomView === tab.id;
            const label = tab.id === "inbox" && approvals.length > 0 ? `Inbox (${approvals.length})` : tab.label;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-testid={tab.testId}
                aria-selected={selected}
                className={`rounded px-2 py-1 text-xs font-semibold tracking-wide uppercase ${
                  selected ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
                onClick={() => {
                  layout.showBottomView(tab.id);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <CollapseControl
          testId="collapse-bottom"
          title="panels under the canvas"
          collapsed={layout.bottomCollapsed}
          onToggle={layout.toggleBottom}
        />
      </div>
      <div hidden={layout.bottomCollapsed} className="flex min-h-0 flex-1 flex-col">
        <Panel view="board" hidden={layout.bottomCollapsed || layout.bottomView !== "board"}>
          <TaskBoard />
        </Panel>
        <Panel view="inbox" hidden={layout.bottomCollapsed || layout.bottomView !== "inbox"}>
          <ApprovalInbox height={bodyHeight} />
        </Panel>
        <Panel view="history" hidden={layout.bottomCollapsed || layout.bottomView !== "history"}>
          <RunHistory />
        </Panel>
        <Panel view="log" hidden={layout.bottomCollapsed || layout.bottomView !== "log"}>
          <RunLog />
        </Panel>
      </div>
    </div>
  );
}

function Panel({ view, hidden, children }: { view: BottomView; hidden: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" hidden={hidden} className="flex min-h-0 flex-1 flex-col overflow-auto" data-bottom-view={view}>
      {children}
    </div>
  );
}
