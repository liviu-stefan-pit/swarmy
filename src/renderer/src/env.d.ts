/// <reference types="electron-vite/client" />
/// <reference types="vite/client" />

import type { SwarmyApi } from "@shared/swarmy-api";

declare global {
  interface Window {
    swarmy: SwarmyApi;
    __swarmyFlushWorkflow?: () => Promise<void>;
  }
}

export {};
