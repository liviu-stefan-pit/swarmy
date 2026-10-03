import type { AgentRuntime } from "./runtime";
import { FAKE_RUN_TEXT, FakeRuntime } from "./fake-runtime";

export async function createRuntime(): Promise<AgentRuntime> {
  if (process.env.SWARMY_RUNTIME === "fake") {
    return new FakeRuntime({
      accountLabel: "fake@swarmy.local",
      models: [{ id: "fake-model" }],
      helloText: "Hello from the fake runtime.",
      defaultPrompt: {
        chunks: [FAKE_RUN_TEXT],
        status: "finished",
        result: FAKE_RUN_TEXT,
      },
    });
  }

  const { CursorSdkRuntime } = await import("./cursor-sdk-runtime");
  return new CursorSdkRuntime();
}
