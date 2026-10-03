import { expect, it } from "vitest";
import { appInfo } from "./app-info";

it("returns the Swarmy name", () => {
  expect(appInfo().name).toBe("Swarmy");
});
