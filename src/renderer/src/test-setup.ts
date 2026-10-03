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
};

window.swarmy = swarmy;
