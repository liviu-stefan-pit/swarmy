import { boardTaskSchema, type BoardTask } from "@shared/runs";
import type { AgentRuntime } from "./runtime";
import { FAKE_RUN_TEXT, FakeRuntime } from "./fake-runtime";

export async function createRuntime(): Promise<AgentRuntime> {
  if (process.env.SWARMY_RUNTIME === "fake") {
    const task = scriptedTask();
    return new FakeRuntime({
      accountLabel: "fake@swarmy.local",
      models: [{ id: "fake-model" }],
      helloText: "Hello from the fake runtime.",
      defaultPrompt: {
        chunks: [FAKE_RUN_TEXT],
        status: "finished",
        result: FAKE_RUN_TEXT,
        ...(task ? { task } : {}),
      },
    });
  }

  const { CursorSdkRuntime } = await import("./cursor-sdk-runtime");
  return new CursorSdkRuntime();
}

function scriptedTask(): BoardTask | undefined {
  const raw = process.env.SWARMY_FAKE_TASK?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const task = boardTaskSchema.safeParse(parsed);
    return task.success ? task.data : undefined;
  } catch {
    return undefined;
  }
}
