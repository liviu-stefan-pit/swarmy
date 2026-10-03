import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { appInfo } from "@shared/app-info";
import { startEngineHost, type EngineHost } from "./engine-host";
import { registerSettingsIpc } from "./settings-ipc";
import { registerWorkflowIpc } from "./workflow-ipc";

app.setName(appInfo().name);

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
  registerSettingsIpc(engine);
  registerWorkflowIpc(engine);
  openWindow(engine);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWindow(engine);
    }
  });
});

function openWindow(engine: EngineHost): void {
  const window = createWindow();
  flushWorkflowOnClose(window);
  engine.bindWindow(window);
}

function flushWorkflowOnClose(window: BrowserWindow): void {
  let closing = false;
  window.on("close", (event) => {
    if (closing || window.webContents.isDestroyed()) {
      return;
    }
    event.preventDefault();
    closing = true;
    const flush = window.webContents
      .executeJavaScript("globalThis.__swarmyFlushWorkflow?.() ?? null")
      .then(
        () => undefined,
        () => undefined,
      );
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, 3000);
    });
    void Promise.race([flush, timeout]).finally(() => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
