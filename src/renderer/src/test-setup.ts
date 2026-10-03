import "@testing-library/jest-dom/vitest";
import type { SwarmyApi } from "@shared/swarmy-api";

const swarmy: SwarmyApi = {
  engine: {
    onStatus(listener) {
      listener("reconnecting");
      return () => undefined;
    },
  },
};

window.swarmy = swarmy;
