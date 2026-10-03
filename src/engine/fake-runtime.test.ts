import { expect, it, vi } from "vitest";
import { FakeRuntime } from "./fake-runtime";

it("returns a scripted model list and hello result without calling the network", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });

  const runtime = new FakeRuntime({
    accountLabel: "ada@example.com",
    models: [{ id: "composer-2.5" }, { id: "auto" }],
    helloText: "hello from fake",
  });
  const apiKey = "cursor_test_key_do_not_send";

  await expect(runtime.account(apiKey)).resolves.toEqual({ label: "ada@example.com" });
  await expect(runtime.models(apiKey)).resolves.toEqual([{ id: "composer-2.5" }, { id: "auto" }]);
  await expect(
    runtime.hello({
      apiKey,
      cwd: "C:\\temp\\swarmy-hello",
      prompt: "Say hello",
      systemPrompt: "Be brief.",
    }),
  ).resolves.toEqual({ text: "hello from fake", systemPromptAccepted: true });

  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
