import { create } from "zustand";

type McpToolsState = {
  byNodeId: Record<string, readonly string[]>;
  setTools: (nodeId: string, tools: readonly string[]) => void;
};

export const useMcpToolsStore = create<McpToolsState>((set) => ({
  byNodeId: {},
  setTools: (nodeId, tools) => {
    set((state) => ({ byNodeId: { ...state.byNodeId, [nodeId]: tools } }));
  },
}));
