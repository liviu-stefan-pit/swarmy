import { create } from "zustand";

export const panelLayoutStorageKey = "swarmy.panel-layout";

const paletteWidthLimits = { min: 160, max: 480 };
const inspectorWidthLimits = { min: 220, max: 560 };
const bottomHeightLimits = { min: 140, max: 720 };
const minEditorHeight = 160;

export const collapsedRailWidth = 40;

export const bottomViews = ["board", "inbox", "history", "log"] as const;

export type BottomView = (typeof bottomViews)[number];

export const defaultPanelLayout = {
  paletteWidth: 240,
  inspectorWidth: 320,
  bottomHeight: 280,
  paletteCollapsed: false,
  inspectorCollapsed: false,
  bottomView: "log" as BottomView,
  bottomCollapsed: false,
};

export type PanelLayoutState = typeof defaultPanelLayout;

type PanelLayoutStore = PanelLayoutState & {
  setPaletteWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
  togglePalette: () => void;
  toggleInspector: () => void;
  showBottomView: (view: BottomView) => void;
  toggleBottom: () => void;
  openReview: () => void;
};

type DragEdge = "palette" | "inspector" | "bottom";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function displayedBottomHeight(state: PanelLayoutState): number | undefined {
  if (state.bottomCollapsed) {
    return undefined;
  }
  return state.bottomHeight;
}

export function maxBottomHeight(): number {
  const stack = document.querySelector("[data-testid='bottom-stack']");
  const editor = document.querySelector("[data-testid='workflow-editor']");
  const stackHeight = stack?.getBoundingClientRect().height ?? 0;
  const editorHeight = editor?.getBoundingClientRect().height ?? 0;
  const shared =
    stackHeight === 0 && editorHeight === 0
      ? window.innerHeight - minEditorHeight
      : stackHeight + editorHeight - minEditorHeight;
  const header = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
  const footer = document.querySelector("[data-testid='engine-status']")?.getBoundingClientRect().height ?? 0;
  const connection = document.querySelector("details")?.getBoundingClientRect().height ?? 0;
  const windowCap = window.innerHeight - header - footer - connection - minEditorHeight;
  return Math.max(bottomHeightLimits.min, Math.round(Math.min(shared, windowCap)));
}

/** Half the space between the header and the footer. A new approval grows the area to at least this. */
export function reviewFloor(): number {
  const header = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
  const footer = document.querySelector("[data-testid='engine-status']")?.getBoundingClientRect().height ?? 0;
  const connection = document.querySelector("details")?.getBoundingClientRect().height ?? 0;
  return Math.round((window.innerHeight - header - footer - connection) / 2);
}

function maxStoredBottomHeight(): number {
  return Math.min(bottomHeightLimits.max, maxBottomHeight());
}

function isBottomView(value: unknown): value is BottomView {
  return bottomViews.some((view) => view === value);
}

type StoredLayout = {
  paletteWidth: number;
  inspectorWidth: number;
  bottomHeight: number;
  paletteCollapsed: boolean;
  inspectorCollapsed: boolean;
  bottomView?: unknown;
  bottomCollapsed?: unknown;
};

function isLayoutState(value: unknown): value is StoredLayout {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.paletteWidth === "number" &&
    typeof record.inspectorWidth === "number" &&
    typeof record.bottomHeight === "number" &&
    typeof record.paletteCollapsed === "boolean" &&
    typeof record.inspectorCollapsed === "boolean"
  );
}

export function readPanelLayout(): PanelLayoutState {
  try {
    const raw = localStorage.getItem(panelLayoutStorageKey);
    if (!raw) {
      return { ...defaultPanelLayout };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isLayoutState(parsed)) {
      return { ...defaultPanelLayout };
    }
    return {
      paletteWidth: clamp(parsed.paletteWidth, paletteWidthLimits.min, paletteWidthLimits.max),
      inspectorWidth: clamp(parsed.inspectorWidth, inspectorWidthLimits.min, inspectorWidthLimits.max),
      bottomHeight: clamp(
        parsed.bottomHeight,
        bottomHeightLimits.min,
        Math.min(bottomHeightLimits.max, Math.max(bottomHeightLimits.min, window.innerHeight - minEditorHeight)),
      ),
      paletteCollapsed: parsed.paletteCollapsed,
      inspectorCollapsed: parsed.inspectorCollapsed,
      bottomView: isBottomView(parsed.bottomView) ? parsed.bottomView : defaultPanelLayout.bottomView,
      bottomCollapsed: parsed.bottomCollapsed === true,
    };
  } catch {
    return { ...defaultPanelLayout };
  }
}

function storedLayout(state: PanelLayoutStore): PanelLayoutState {
  return {
    paletteWidth: state.paletteWidth,
    inspectorWidth: state.inspectorWidth,
    bottomHeight: state.bottomHeight,
    paletteCollapsed: state.paletteCollapsed,
    inspectorCollapsed: state.inspectorCollapsed,
    bottomView: state.bottomView,
    bottomCollapsed: state.bottomCollapsed,
  };
}

function writePanelLayout(state: PanelLayoutStore): void {
  localStorage.setItem(panelLayoutStorageKey, JSON.stringify(storedLayout(state)));
}

function commit(
  set: (partial: Partial<PanelLayoutState>) => void,
  get: () => PanelLayoutStore,
  partial: Partial<PanelLayoutState>,
): void {
  set(partial);
  writePanelLayout(get());
}

export const usePanelLayoutStore = create<PanelLayoutStore>((set, get) => ({
  ...readPanelLayout(),
  setPaletteWidth: (width) => {
    commit(set, get, { paletteWidth: clamp(width, paletteWidthLimits.min, paletteWidthLimits.max) });
  },
  setInspectorWidth: (width) => {
    commit(set, get, { inspectorWidth: clamp(width, inspectorWidthLimits.min, inspectorWidthLimits.max) });
  },
  setBottomHeight: (height) => {
    commit(set, get, {
      bottomHeight: clamp(height, bottomHeightLimits.min, maxStoredBottomHeight()),
    });
  },
  togglePalette: () => {
    commit(set, get, { paletteCollapsed: !get().paletteCollapsed });
  },
  toggleInspector: () => {
    commit(set, get, { inspectorCollapsed: !get().inspectorCollapsed });
  },
  showBottomView: (view) => {
    commit(set, get, { bottomView: view, bottomCollapsed: false });
  },
  toggleBottom: () => {
    commit(set, get, { bottomCollapsed: !get().bottomCollapsed });
  },
  openReview: () => {
    const cap = maxStoredBottomHeight();
    const next = Math.min(cap, Math.max(get().bottomHeight, reviewFloor()));
    commit(set, get, {
      bottomView: "inbox",
      bottomCollapsed: false,
      bottomHeight: clamp(next, bottomHeightLimits.min, cap),
    });
  },
}));

export function reloadPanelLayout(): void {
  usePanelLayoutStore.setState(readPanelLayout());
}

export function startPanelDrag(
  edge: DragEdge,
  event: { button: number; clientX: number; clientY: number; preventDefault: () => void },
): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const start = usePanelLayoutStore.getState();
  const onMove = (move: PointerEvent) => {
    const layout = usePanelLayoutStore.getState();
    if (edge === "palette") {
      layout.setPaletteWidth(start.paletteWidth + (move.clientX - startX));
    } else if (edge === "inspector") {
      layout.setInspectorWidth(start.inspectorWidth - (move.clientX - startX));
    } else {
      if (start.bottomCollapsed) {
        return;
      }
      const nextDisplayed = start.bottomHeight - (move.clientY - startY);
      const clamped = Math.min(Math.max(nextDisplayed, bottomHeightLimits.min), maxBottomHeight());
      layout.setBottomHeight(clamped);
    }
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
