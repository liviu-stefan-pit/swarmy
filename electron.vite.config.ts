import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const shared = resolve("src/shared");

export default defineConfig({
  main: {
    resolve: {
      alias: { "@shared": shared },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          engine: resolve("src/engine/index.ts"),
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: { "@shared": shared },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": shared,
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
