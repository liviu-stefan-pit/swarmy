import type { EngineMessage } from "@shared/protocol";
import { attachEngine, type EnginePort } from "./engine";

interface UtilityParentPort {
  postMessage(message: EngineMessage): void;
  on(event: "message", listener: (event: unknown) => void): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUtilityParentPort(value: unknown): value is UtilityParentPort {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.postMessage === "function" && typeof value.on === "function";
}

export function readParentPort(host: object = process): UtilityParentPort {
  const candidate: unknown = Reflect.get(host, "parentPort");
  if (!isUtilityParentPort(candidate)) {
    throw new Error("Swarmy engine must run inside an Electron utility process");
  }
  return candidate;
}

function messageData(event: unknown): unknown {
  if (!isRecord(event) || !("data" in event)) {
    return undefined;
  }
  return event.data;
}

export function listenOnParentPort(parent: UtilityParentPort): void {
  const port: EnginePort = {
    postMessage(message) {
      parent.postMessage(message);
    },
    onMessage(listener) {
      parent.on("message", (event: unknown) => {
        listener(messageData(event));
      });
    },
  };

  attachEngine(port);
  port.postMessage({ type: "engine.ready" });
}
