import { expect, it, vi } from "vitest";
import { startAgentRun } from "./agent-run";
import { FakeRuntime } from "./fake-runtime";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
};

const request = {
  apiKey: "cursor_test_key_do_not_send",
  cwd: "C:\\temp\\swarmy-run",
};

it("streams two assistant chunks, a finished result, and disposes the agent", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });

  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "Say ping": {
        chunks: ["pon", "g"],
        status: "finished",
        result: "pong",
      },
    },
  });

  const agent = await runtime.create(request);
  const run = await agent.send("Say ping");
  const chunks: string[] = [];
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      chunks.push(event.text);
    }
  }
  const result = await run.wait();
  await agent.dispose();

  expect(chunks).toEqual(["pon", "g"]);
  expect(result).toEqual({ status: "finished", text: "pong" });
  expect(runtime.disposeCount).toBe(1);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

it("shows a run error in the log and marks the node failed", async () => {
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "Do the task": {
        chunks: ["starting"],
        status: "error",
        error: "tool exploded",
      },
    },
  });

  const outcome = await startAgentRun({
    runtime,
    request: { ...request, prompt: "Do the task" },
  }).done;

  expect(outcome.log).toContain("starting");
  expect(outcome.log).toContain("tool exploded");
  expect(outcome.status).toBe("failed");
});

it("cancel before the fake finishes yields cancelled", async () => {
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "Take a while": {
        chunks: ["working"],
        hold: true,
      },
    },
  });

  const session = startAgentRun({
    runtime,
    request: { ...request, prompt: "Take a while" },
  });

  await session.until((event) => event.type === "assistant" && event.text === "working");
  await session.cancel();

  await expect(session.done).resolves.toMatchObject({ status: "cancelled" });
});

it("sends one follow-up after revert_to_followup and none after complete_delivered", async () => {
  const followupRuntime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "Do the task": {
        chunks: ["working"],
        hold: true,
        result: "done",
        steer: "revert_to_followup",
      },
      "Answer in one sentence.": { chunks: ["short"], result: "short" },
    },
  });
  const followup = startAgentRun({
    runtime: followupRuntime,
    request: { ...request, prompt: "Do the task" },
  });

  try {
    await followup.until((event) => event.type === "assistant" && event.text === "working");
    const steer = (followup as { steer?: (text: string) => Promise<string> }).steer;
    expect(typeof steer).toBe("function");
    if (!steer) {
      return;
    }
    await expect(steer("Answer in one sentence.")).resolves.toBe("revert_to_followup");
    followupRuntime.releaseHeld();
    const outcome = await followup.done;
    expect(followupRuntime.sentPrompts).toEqual(["Do the task", "Answer in one sentence."]);
    expect(outcome.log).toContain("Steering sent as a follow-up");
  } finally {
    followupRuntime.releaseHeld();
    await followup.done.catch(() => undefined);
  }

  const deliveredRuntime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "Do the task": {
        chunks: ["working"],
        hold: true,
        result: "done",
        steer: "complete_delivered",
      },
    },
  });
  const delivered = startAgentRun({
    runtime: deliveredRuntime,
    request: { ...request, prompt: "Do the task" },
  });

  try {
    await delivered.until((event) => event.type === "assistant" && event.text === "working");
    const steer = (delivered as { steer?: (text: string) => Promise<string> }).steer;
    expect(typeof steer).toBe("function");
    if (!steer) {
      return;
    }
    await expect(steer("Answer in one sentence.")).resolves.toBe("complete_delivered");
    deliveredRuntime.releaseHeld();
    const outcome = await delivered.done;
    expect(deliveredRuntime.sentPrompts).toEqual(["Do the task"]);
    expect(outcome.log).toContain("Steering delivered");
    expect(outcome.log).not.toContain("follow-up");
  } finally {
    deliveredRuntime.releaseHeld();
    await delivered.done.catch(() => undefined);
  }
});
