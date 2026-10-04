import { app, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appInfo } from "@shared/app-info";
import { triggerRunChannel, triggerRunEventSchema, triggerSkipChannel, triggerSkipSchema } from "@shared/triggers";
import type { Workflow } from "@shared/workflow";
import { startEngineHost, type EngineHost } from "./engine-host";
import { registerMcpIpc } from "./mcp-ipc";
import { registerRunIpc, startTriggeredRun } from "./run-ipc";
import { registerSettingsIpc } from "./settings-ipc";
import { createTriggerHost, type TriggerHost } from "./triggers";
import { registerWorkflowIpc } from "./workflow-ipc";

app.setName(appInfo().name);
app.setAppUserModelId("Swarmy");

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
  const triggers = createTriggerHost({
    startRun(workflow) {
      return startTriggeredRun(engine, workflow);
    },
    onSkip(skip) {
      broadcast(triggerSkipChannel, triggerSkipSchema.parse(skip));
    },
    onRun(event) {
      broadcast(triggerRunChannel, triggerRunEventSchema.parse(event));
    },
  });
  const catalog = triggerCatalog(engine, triggers);
  registerSettingsIpc(engine);
  registerWorkflowIpc(engine, {
    onSaved: (workflow) => {
      catalog.saved(workflow);
    },
    onDeleted: (id) => {
      catalog.deleted(id);
    },
  });
  registerRunIpc(engine, triggers);
  registerMcpIpc();
  openWindow(engine);
  void engine.ready.then(() => catalog.loadAll()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not arm triggers";
    console.error(message);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWindow(engine);
    }
  });
});

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function triggerCatalog(engine: EngineHost, host: TriggerHost) {
  const known = new Map<string, Workflow>();
  const dirty = new Set<string>();

  return {
    saved(workflow: Workflow) {
      dirty.add(workflow.id);
      known.set(workflow.id, workflow);
      host.sync([...known.values()]);
    },
    deleted(id: string) {
      dirty.add(id);
      known.delete(id);
      host.sync([...known.values()]);
    },
    async loadAll() {
      const listed = await engine.request({ type: "workflow.list", id: randomUUID() });
      if (listed.type !== "workflow.listResult") {
        return;
      }
      for (const summary of listed.workflows) {
        if (dirty.has(summary.id)) {
          continue;
        }
        const loaded = await engine.request({
          type: "workflow.load",
          id: randomUUID(),
          workflowId: summary.id,
        });
        if (loaded.type !== "workflow.loadResult" || dirty.has(summary.id)) {
          continue;
        }
        known.set(loaded.workflow.id, loaded.workflow);
      }
      host.sync([...known.values()]);
    },
  };
}

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
