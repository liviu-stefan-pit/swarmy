import type { AgentRuntime } from "./runtime";
import { FakeRuntime } from "./fake-runtime";

export async function createRuntime(): Promise<AgentRuntime> {
  if (process.env.SWARMY_RUNTIME === "fake") {
    return new FakeRuntime({
      accountLabel: "fake@swarmy.local",
      models: [{ id: "fake-model" }],
      helloText: "Hello from the fake runtime.",
    });
  }

  const { CursorSdkRuntime } = await import("./cursor-sdk-runtime");
  return new CursorSdkRuntime();
}
