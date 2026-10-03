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
