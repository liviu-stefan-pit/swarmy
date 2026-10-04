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
import {
  boardTaskSchema,
  boardUpdateChannel,
  plannerUpdateChannel,
  plannerWorkerSchema,
  runUpdateChannel,
  runUpdateSchema,
} from "@shared/runs";
import { ReconnectCounter } from "./reconnect-counter";

const RESTART_DELAY_MS = 1000;
const TEST_TIMEOUT_MS = 30_000;
const HELLO_TIMEOUT_MS = 180_000;
const WORKFLOW_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const CANCEL_TIMEOUT_MS = 30_000;

const resultByRequest = {
  "cursor.test": "cursor.testResult",
  "cursor.hello": "cursor.helloResult",
  "workflow.save": "workflow.saveResult",
  "workflow.load": "workflow.loadResult",
  "workflow.list": "workflow.listResult",
  "workflow.delete": "workflow.deleteResult",
  "run.start": "run.done",
  "run.cancel": "run.cancelResult",
  "run.steer": "run.steerResult",
  "run.unfinished": "run.unfinishedResult",
  "run.history": "run.historyResult",
  "run.historyOpen": "run.historyOpenResult",
  "run.historyRefresh": "run.historyRefreshResult",
  "run.checkpoints": "run.checkpointsResult",
  "run.fork": "run.forkResult",
  "workflow.run": "workflow.runDone",
  "workflow.resume": "workflow.runDone",
  "workflow.cancel": "workflow.cancelResult",
  "approval.list": "approval.listResult",
  "approval.decide": "approval.decideResult",
} as const;

type EngineRequestType = keyof typeof resultByRequest;
type EngineRequest = Extract<EngineMessage, { type: EngineRequestType }>;
type EngineSuccess = Extract<EngineMessage, { type: (typeof resultByRequest)[EngineRequestType] }>;
type EngineFailure = Extract<EngineMessage, { type: "cursor.failed" | "workflow.failed" | "run.failed" }>;

export interface EngineHost {
  bindWindow(window: BrowserWindow): void;
  request(message: EngineRequest): Promise<EngineSuccess>;
}

interface Waiter {
  expected: EngineSuccess["type"];
  resolve: (message: EngineSuccess) => void;
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
        if (parsed.type === "run.update") {
          broadcastRunUpdate(parsed);
          return;
        }
        if (parsed.type === "board.update") {
          broadcastBoardUpdate(parsed);
          return;
        }
        if (parsed.type === "planner.update") {
          broadcastPlannerUpdate(parsed);
          return;
        }
        if (isEngineReply(parsed)) {
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
      const expected = resultByRequest[message.type];
      const timeout = timeoutFor(message.type);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new Error(timeout.timeoutMessage));
        }, timeout.timeoutMs);
        pending.set(message.id, {
          expected,
          timer,
          reject,
          resolve: (value) => {
            if (value.type !== expected) {
              reject(new Error("Unexpected engine response"));
              return;
            }
            resolve(value);
          },
        });
        current.postMessage(message);
      });
    },
  };
}

function settle(pending: Map<string, Waiter>, message: EngineSuccess | EngineFailure): void {
  const waiter = pending.get(message.id);
  if (!waiter) {
    return;
  }
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.type === "cursor.failed" || message.type === "workflow.failed" || message.type === "run.failed") {
    waiter.reject(new Error(message.message));
    return;
  }
  if (message.type !== waiter.expected) {
    waiter.reject(new Error("Unexpected engine response"));
    return;
  }
  waiter.resolve(message);
}

function isEngineReply(message: EngineMessage): message is EngineSuccess | EngineFailure {
  return (
    message.type === "cursor.testResult" ||
    message.type === "cursor.helloResult" ||
    message.type === "cursor.failed" ||
    message.type === "workflow.saveResult" ||
    message.type === "workflow.loadResult" ||
    message.type === "workflow.listResult" ||
    message.type === "workflow.deleteResult" ||
    message.type === "workflow.failed" ||
    message.type === "run.done" ||
    message.type === "run.cancelResult" ||
    message.type === "run.steerResult" ||
    message.type === "run.unfinishedResult" ||
    message.type === "run.historyResult" ||
    message.type === "run.historyOpenResult" ||
    message.type === "run.historyRefreshResult" ||
    message.type === "run.checkpointsResult" ||
    message.type === "run.forkResult" ||
    message.type === "run.failed" ||
    message.type === "workflow.runDone" ||
    message.type === "workflow.cancelResult" ||
    message.type === "approval.listResult" ||
    message.type === "approval.decideResult"
  );
}

function timeoutFor(type: EngineRequestType): { timeoutMs: number; timeoutMessage: string } {
  switch (type) {
    case "cursor.hello":
      return { timeoutMs: HELLO_TIMEOUT_MS, timeoutMessage: "Hello run timed out" };
    case "cursor.test":
      return { timeoutMs: TEST_TIMEOUT_MS, timeoutMessage: "Test connection timed out" };
    case "run.start":
      return { timeoutMs: RUN_TIMEOUT_MS, timeoutMessage: "Agent run timed out" };
    case "workflow.run":
    case "workflow.resume":
      return { timeoutMs: RUN_TIMEOUT_MS, timeoutMessage: "Workflow run timed out" };
    case "run.cancel":
    case "workflow.cancel":
    case "run.steer":
      return { timeoutMs: CANCEL_TIMEOUT_MS, timeoutMessage: "Cancel timed out" };
    case "run.historyRefresh":
      return { timeoutMs: TEST_TIMEOUT_MS, timeoutMessage: "Cost refresh timed out" };
    case "run.checkpoints":
    case "run.fork":
    case "run.unfinished":
    case "run.history":
    case "run.historyOpen":
    case "approval.list":
    case "approval.decide":
      return { timeoutMs: WORKFLOW_TIMEOUT_MS, timeoutMessage: "Workflow request timed out" };
    case "workflow.delete":
    case "workflow.list":
    case "workflow.load":
    case "workflow.save":
      return { timeoutMs: WORKFLOW_TIMEOUT_MS, timeoutMessage: "Workflow request timed out" };
  }
}

function broadcastPlannerUpdate(message: Extract<EngineMessage, { type: "planner.update" }>): void {
  const workers = plannerWorkerSchema.array().parse(message.workers);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(plannerUpdateChannel, workers);
    }
  }
}

function broadcastBoardUpdate(message: Extract<EngineMessage, { type: "board.update" }>): void {
  const tasks = boardTaskSchema.array().parse(message.tasks);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(boardUpdateChannel, tasks);
    }
  }
}

function broadcastRunUpdate(message: Extract<EngineMessage, { type: "run.update" }>): void {
  const update = runUpdateSchema.parse({
    nodeId: message.nodeId,
    status: message.status,
    log: message.log,
    ...(message.workspacePath ? { workspacePath: message.workspacePath } : {}),
    ...(message.files && message.files.length > 0 ? { files: message.files } : {}),
  });
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(runUpdateChannel, update);
    }
  }
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
