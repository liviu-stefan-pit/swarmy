import { parseEngineMessage, type EngineMessage } from "@shared/protocol";

export interface EnginePort {
  postMessage(message: EngineMessage): void;
  onMessage(listener: (message: unknown) => void): void;
}

export function attachEngine(port: EnginePort): void {
  port.onMessage((input: unknown) => {
    const message = readMessage(input);
    if (!message) {
      return;
    }

    if (message.type === "engine.ping") {
      port.postMessage({ type: "engine.pong", id: message.id });
      return;
    }

    if (message.type === "engine.hello") {
      port.postMessage({ type: "engine.ready" });
    }
  });
}

function readMessage(input: unknown): EngineMessage | undefined {
  try {
    return parseEngineMessage(input);
  } catch {
    // Ignore payloads that are not part of the engine protocol.
    return undefined;
  }
}
