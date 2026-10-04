import { create } from "zustand";

export const panelLayoutStorageKey = "swarmy.panel-layout";

const paletteWidthLimits = { min: 160, max: 480 };
const inspectorWidthLimits = { min: 220, max: 560 };
const bottomHeightLimits = { min: 140, max: 720 };
const minEditorHeight = 160;

export const collapsedRailWidth = 40;

export const defaultPanelLayout = {
  paletteWidth: 240,
  inspectorWidth: 320,
  bottomHeight: 280,
  paletteCollapsed: false,
  inspectorCollapsed: false,
  inboxCollapsed: false,
  historyCollapsed: false,
  runLogCollapsed: false,
  boardCollapsed: false,
};

export type PanelLayoutState = typeof defaultPanelLayout;

type PanelLayoutStore = PanelLayoutState & {
  setPaletteWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
  togglePalette: () => void;
  toggleInspector: () => void;
  toggleInbox: () => void;
  toggleHistory: () => void;
  toggleRunLog: () => void;
  toggleBoard: () => void;
};

type DragEdge = "palette" | "inspector" | "bottom";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const totalBottomWeight = 5;

export function openBottomWeight(state: PanelLayoutState): number {
  return (
    (state.boardCollapsed ? 0 : 1) +
    (state.inboxCollapsed ? 0 : 1) +
    (state.historyCollapsed ? 0 : 1) +
    (state.runLogCollapsed ? 0 : 2)
  );
}

export function displayedBottomHeight(state: PanelLayoutState): number | undefined {
  const weight = openBottomWeight(state);
  if (weight === 0) {
    return undefined;
  }
  return Math.round((state.bottomHeight * weight) / totalBottomWeight);
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

function bottomScale(state: PanelLayoutState): number {
  const weight = openBottomWeight(state);
  return weight === 0 ? 1 : weight / totalBottomWeight;
}

function maxStoredBottomHeight(state: PanelLayoutState): number {
  return Math.min(bottomHeightLimits.max, maxBottomHeight() / bottomScale(state));
}

function isLayoutState(value: unknown): value is PanelLayoutState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.paletteWidth === "number" &&
    typeof record.inspectorWidth === "number" &&
    typeof record.bottomHeight === "number" &&
    typeof record.paletteCollapsed === "boolean" &&
    typeof record.inspectorCollapsed === "boolean" &&
    typeof record.inboxCollapsed === "boolean" &&
    typeof record.historyCollapsed === "boolean" &&
    typeof record.runLogCollapsed === "boolean" &&
    (record.boardCollapsed === undefined || typeof record.boardCollapsed === "boolean")
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
      inboxCollapsed: parsed.inboxCollapsed,
      historyCollapsed: parsed.historyCollapsed,
      runLogCollapsed: parsed.runLogCollapsed,
      boardCollapsed: parsed.boardCollapsed === true,
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
    inboxCollapsed: state.inboxCollapsed,
    historyCollapsed: state.historyCollapsed,
    runLogCollapsed: state.runLogCollapsed,
    boardCollapsed: state.boardCollapsed,
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
      bottomHeight: clamp(height, bottomHeightLimits.min, maxStoredBottomHeight(get())),
    });
  },
  togglePalette: () => {
    commit(set, get, { paletteCollapsed: !get().paletteCollapsed });
  },
  toggleInspector: () => {
    commit(set, get, { inspectorCollapsed: !get().inspectorCollapsed });
  },
  toggleInbox: () => {
    commit(set, get, { inboxCollapsed: !get().inboxCollapsed });
  },
  toggleHistory: () => {
    commit(set, get, { historyCollapsed: !get().historyCollapsed });
  },
  toggleRunLog: () => {
    commit(set, get, { runLogCollapsed: !get().runLogCollapsed });
  },
  toggleBoard: () => {
    commit(set, get, { boardCollapsed: !get().boardCollapsed });
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
      const weight = openBottomWeight(start);
      if (weight === 0) {
        return;
      }
      const scale = weight / totalBottomWeight;
      const nextDisplayed = start.bottomHeight * scale - (move.clientY - startY);
      const minDisplayed = bottomHeightLimits.min * scale;
      const clamped = Math.min(Math.max(nextDisplayed, minDisplayed), maxBottomHeight());
      layout.setBottomHeight(clamped / scale);
    }
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
