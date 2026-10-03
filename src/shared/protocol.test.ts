import { expect, it } from "vitest";
import { parseEngineMessage } from "./protocol";

it("rejects an unknown message type", () => {
  expect(() => parseEngineMessage({ type: "engine.unknown" })).toThrow();
});

it("accepts engine.ping", () => {
  expect(parseEngineMessage({ type: "engine.ping", id: "ping-1" })).toEqual({
    type: "engine.ping",
    id: "ping-1",
  });
});

it("accepts engine.hello, engine.ready, and engine.pong", () => {
  expect(parseEngineMessage({ type: "engine.hello" })).toEqual({ type: "engine.hello" });
  expect(parseEngineMessage({ type: "engine.ready" })).toEqual({ type: "engine.ready" });
  expect(parseEngineMessage({ type: "engine.pong", id: "ping-1" })).toEqual({
    type: "engine.pong",
    id: "ping-1",
  });
});
