import {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  utilityProcess,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from "electron";
import { join } from "node:path";
import {
  engineStatusChannel,
  engineStatusSchema,
  parseEngineMessage,
  type EngineStatus,
} from "@shared/protocol";
import { ReconnectCounter } from "./reconnect-counter";

const RESTART_DELAY_MS = 1000;

export interface EngineHost {
  bindWindow(window: BrowserWindow): void;
}

export function startEngineHost(): EngineHost {
  const counter = new ReconnectCounter();
  let child: UtilityProcess | null = null;
  let quitting = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const broadcast = (status: EngineStatus): void => {
    const payload = engineStatusSchema.parse(status);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(engineStatusChannel, payload);
    }
  };

  const spawn = (): void => {
    const next = utilityProcess.fork(join(__dirname, "engine.js"), [], {
      serviceName: "Swarmy Engine",
      stdio: "inherit",
    });
    child = next;
    let closed = false;

    next.on("message", (message) => {
      if (child !== next) {
        return;
      }
      const payload: unknown = message;
      try {
        const parsed = parseEngineMessage(payload);
        if (parsed.type === "engine.ready") {
          counter.connected();
          broadcast(counter.connection);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid payload";
        console.warn(`Ignored engine message: ${detail}`);
      }
    });

    next.on("spawn", () => {
      if (child !== next) {
        return;
      }
      next.postMessage({ type: "engine.hello" });
      next.postMessage({ type: "engine.ping", id: "startup" });
    });

    next.on("exit", () => {
      if (closed) {
        return;
      }
      closed = true;
      const wasActive = child === next;
      if (wasActive) {
        child = null;
      }
      if (!wasActive || quitting) {
        return;
      }
      const status = counter.unexpectedExit();
      broadcast(status);
      console.log(`Engine exited unexpectedly (${counter.count}). Restarting.`);
      restartTimer = setTimeout(() => {
        if (!quitting) {
          spawn();
        }
      }, RESTART_DELAY_MS);
    });
  };

  app.on("before-quit", () => {
    quitting = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
    }
    child?.kill();
  });

  installDevCrashMenu(() => {
    child?.kill();
  });
  spawn();

  return {
    bindWindow(window) {
      window.webContents.on("did-finish-load", () => {
        window.webContents.send(engineStatusChannel, engineStatusSchema.parse(counter.connection));
      });
    },
  };
}

function installDevCrashMenu(crash: () => void): void {
  if (app.isPackaged) {
    return;
  }

  const devMenu: MenuItemConstructorOptions = {
    label: "Dev",
    submenu: [
      {
        label: "Crash engine",
        accelerator: "CommandOrControl+Shift+F9",
        click: () => {
          crash();
        },
      },
    ],
  };

  const current = Menu.getApplicationMenu();
  if (current) {
    current.append(new MenuItem(devMenu));
    Menu.setApplicationMenu(current);
  } else {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, devMenu]),
    );
  }

  console.log("Dev: press Ctrl+Shift+F9 to crash the engine");
}
