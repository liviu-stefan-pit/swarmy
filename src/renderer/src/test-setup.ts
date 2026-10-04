import "@testing-library/jest-dom/vitest";
import type { SwarmyApi } from "@shared/swarmy-api";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

const swarmy: SwarmyApi = {
  engine: {
    onStatus(listener) {
      listener("reconnecting");
      return () => undefined;
    },
  },
  files: {
    pathForFile() {
      return "";
    },
  },
  mcp: {
    saveHeaders() {
      return Promise.resolve("secret-test");
    },
    readHeaders() {
      return Promise.resolve({});
    },
    listTools() {
      return Promise.resolve([]);
    },
  },
  settings: {
    saveKey() {
      return Promise.resolve();
    },
    hasKey() {
      return Promise.resolve(false);
    },
    testConnection() {
      return Promise.resolve({ accountLabel: "test@swarmy.local", modelIds: ["fake-model"] });
    },
    runHello() {
      return Promise.resolve({
        text: "hello",
        systemPromptAccepted: true,
        cwd: "C:\\temp\\swarmy-hello",
      });
    },
  },
  workflows: {
    list() {
      return Promise.resolve([]);
    },
    load() {
      return Promise.resolve({
        id: "untitled",
        name: "Untitled",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
      });
    },
    save(workflow) {
      return Promise.resolve({
        id: workflow.id,
        name: workflow.name,
        createdAt: 0,
        updatedAt: 0,
      });
    },
    delete() {
      return Promise.resolve();
    },
    exportFile() {
      return Promise.resolve({ status: "cancelled" });
    },
    importFile() {
      return Promise.resolve({ status: "cancelled" });
    },
    commitImport(workflow) {
      return Promise.resolve({
        id: workflow.id,
        name: workflow.name,
        createdAt: 0,
        updatedAt: 0,
      });
    },
  },
  runs: {
    start() {
      return Promise.resolve({ nodeId: "agent-1", status: "completed", log: "" });
    },
    startWorkflow() {
      return Promise.resolve({ statuses: {} });
    },
    cancel() {
      return Promise.resolve();
    },
    cancelWorkflow() {
      return Promise.resolve();
    },
    steer() {
      return Promise.resolve("complete_delivered");
    },
    unfinished() {
      return Promise.resolve(null);
    },
    history() {
      return Promise.resolve([]);
    },
    openHistory() {
      return Promise.resolve({
        threadId: "thread-1",
        status: "completed",
        startedAt: 0,
        endedAt: 0,
        nodes: [],
      });
    },
    refreshHistory() {
      return Promise.resolve({
        threadId: "thread-1",
        status: "completed",
        startedAt: 0,
        endedAt: 0,
        nodes: [],
      });
    },
    checkpoints() {
      return Promise.resolve([]);
    },
    fork() {
      return Promise.resolve({
        threadId: "thread-2",
        nextNodeId: "third",
        statuses: {},
      });
    },
    resume() {
      return Promise.resolve({ statuses: {} });
    },
    pendingApprovals() {
      return Promise.resolve([]);
    },
    decide() {
      return Promise.resolve();
    },
    onUpdate() {
      return () => undefined;
    },
    onBoard() {
      return () => undefined;
    },
    onPlanner() {
      return () => undefined;
    },
  },
};

window.swarmy = swarmy;
