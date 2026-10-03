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
  type EngineMessage,
  type EngineStatus,
} from "@shared/protocol";
import { ReconnectCounter } from "./reconnect-counter";

const RESTART_DELAY_MS = 1000;
const TEST_TIMEOUT_MS = 30_000;
const HELLO_TIMEOUT_MS = 180_000;

export type CursorRequest = Extract<EngineMessage, { type: "cursor.test" | "cursor.hello" }>;
export type CursorSuccess = Extract<EngineMessage, { type: "cursor.testResult" | "cursor.helloResult" }>;

export interface EngineHost {
  bindWindow(window: BrowserWindow): void;
  request(message: CursorRequest): Promise<CursorSuccess>;
}

interface Waiter {
  expected: CursorSuccess["type"];
  resolve: (message: CursorSuccess) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function startEngineHost(): EngineHost {
  const counter = new ReconnectCounter();
  const pending = new Map<string, Waiter>();
  let child: UtilityProcess | null = null;
  let quitting = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const broadcast = (status: EngineStatus): void => {
    const payload = engineStatusSchema.parse(status);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(engineStatusChannel, payload);
    }
  };

  const failPending = (error: Error): void => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };

  const spawn = (): void => {
    const next = utilityProcess.fork(join(__dirname, "engine.js"), [], {
      serviceName: "Swarmy Engine",
      stdio: "inherit",
      env: engineEnvironment(),
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
          return;
        }
        if (parsed.type === "sqlite.probeResult") {
          logSqliteProbe(parsed);
          return;
        }
        if (parsed.type === "cursor.testResult" || parsed.type === "cursor.helloResult" || parsed.type === "cursor.failed") {
          settle(pending, parsed);
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
      failPending(new Error("Engine reconnecting"));
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
    failPending(new Error("Engine is shutting down"));
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
    request(message) {
      const current = child;
      if (!current) {
        return Promise.reject(new Error("Engine is not connected"));
      }
      const expected = message.type === "cursor.test" ? "cursor.testResult" : "cursor.helloResult";
      const timeoutMs = message.type === "cursor.test" ? TEST_TIMEOUT_MS : HELLO_TIMEOUT_MS;
      const timeoutMessage = message.type === "cursor.test" ? "Test connection timed out" : "Hello run timed out";
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new Error(timeoutMessage));
        }, timeoutMs);
        pending.set(message.id, {
          expected,
          timer,
          resolve,
          reject,
        });
        current.postMessage(message);
      });
    },
  };
}

function settle(
  pending: Map<string, Waiter>,
  message: Extract<EngineMessage, { type: "cursor.testResult" | "cursor.helloResult" | "cursor.failed" }>,
): void {
  const waiter = pending.get(message.id);
  if (!waiter) {
    return;
  }
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.type === "cursor.failed") {
    waiter.reject(new Error(message.message));
    return;
  }
  if (message.type !== waiter.expected) {
    waiter.reject(new Error("Unexpected engine response"));
    return;
  }
  waiter.resolve(message);
}

function logSqliteProbe(message: Extract<EngineMessage, { type: "sqlite.probeResult" }>): void {
  if (message.ok) {
    console.log(`node:sqlite in the engine process: ok (${message.value ?? ""})`);
    return;
  }
  console.error(`node:sqlite in the engine process: failed (${message.message ?? "unknown error"})`);
}

function engineEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
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
