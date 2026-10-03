import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { appInfo } from "@shared/app-info";
import { startEngineHost } from "./engine-host";

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    title: appInfo().name,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on("ready-to-show", () => {
    window.setTitle(appInfo().name);
    window.show();
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

void app.whenReady().then(() => {
  const engine = startEngineHost();
  engine.bindWindow(createWindow());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      engine.bindWindow(createWindow());
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
