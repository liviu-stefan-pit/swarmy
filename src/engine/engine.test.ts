import { expect, it } from "vitest";
import { attachEngine } from "./engine";

it("answers engine.ping with engine.pong", () => {
  const posted: unknown[] = [];
  let deliver: ((message: unknown) => void) | undefined;

  attachEngine({
    postMessage(message) {
      posted.push(message);
    },
    onMessage(listener) {
      deliver = listener;
    },
  });

  if (!deliver) {
    throw new Error("engine did not subscribe to the port");
  }

  deliver({ type: "engine.ping", id: "ping-1" });

  expect(posted).toEqual([{ type: "engine.pong", id: "ping-1" }]);
});

it("answers engine.hello with engine.ready", () => {
  const posted: unknown[] = [];
  let deliver: ((message: unknown) => void) | undefined;

  attachEngine({
    postMessage(message) {
      posted.push(message);
    },
    onMessage(listener) {
      deliver = listener;
    },
  });

  if (!deliver) {
    throw new Error("engine did not subscribe to the port");
  }

  deliver({ type: "engine.hello" });

  expect(posted).toEqual([{ type: "engine.ready" }]);
});
