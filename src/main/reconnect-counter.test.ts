import { expect, it } from "vitest";
import { ReconnectCounter } from "./reconnect-counter";

it("counts unexpected exits and reports reconnecting", () => {
  const counter = new ReconnectCounter();

  counter.connected();
  expect(counter.count).toBe(0);
  expect(counter.connection).toBe("connected");

  expect(counter.unexpectedExit()).toBe("reconnecting");
  expect(counter.count).toBe(1);

  counter.connected();
  counter.unexpectedExit();
  expect(counter.count).toBe(2);
  expect(counter.connection).toBe("reconnecting");
});
