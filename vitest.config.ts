import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const shared = resolve("src/shared");

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: { "@shared": shared },
        },
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/shared/**/*.test.ts",
            "src/engine/**/*.test.ts",
            "src/main/**/*.test.ts",
            "src/preload/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: { "@shared": shared },
        },
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/renderer/**/*.test.ts", "src/renderer/**/*.test.tsx"],
          setupFiles: ["./src/renderer/src/test-setup.ts"],
        },
      },
    ],
  },
});
