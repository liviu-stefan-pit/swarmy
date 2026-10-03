import { expect, it } from "vitest";
import { runHello, type HelloAgent } from "./hello-run";

const SYSTEM_PROMPT_ERROR = "[invalid_argument] unknown option '--system-prompt'";

it("retries when systemPrompt is rejected as a finished run error", async () => {
  const created: Array<string | undefined> = [];
  const prompts: string[] = [];
  let disposed = 0;

  const result = await runHello({
    prompt: "Say hello",
    systemPrompt: "Be brief.",
    createAgent: (systemPrompt) => {
      created.push(systemPrompt);
      return Promise.resolve(agent(systemPrompt, prompts, () => {
        disposed += 1;
      }));
    },
  });

  expect(created).toEqual(["Be brief.", undefined]);
  expect(prompts).toEqual(["Say hello", "Be brief.\n\nSay hello"]);
  expect(result).toEqual({
    text: "Hello.",
    systemPromptAccepted: false,
    warning: "systemPrompt is not available on this account. The instructions were prefixed to the prompt.",
  });
  expect(disposed).toBe(2);
});

it("does not retry a hello run that failed for another reason", async () => {
  const prompts: string[] = [];

  await expect(
    runHello({
      prompt: "Say hello",
      systemPrompt: "Be brief.",
      createAgent: () => Promise.resolve(agent("Be brief.", prompts, () => undefined, "model missing")),
    }),
  ).rejects.toThrow("model missing");
  expect(prompts).toEqual(["Say hello"]);
});

function agent(
  systemPrompt: string | undefined,
  prompts: string[],
  onDispose: () => void,
  failure?: string,
): HelloAgent {
  return {
    agentId: systemPrompt ? "agent-with-prompt" : "agent-without-prompt",
    async send(prompt) {
      prompts.push(prompt);
      const rejected = systemPrompt !== undefined && failure === undefined;
      return {
        id: systemPrompt ? "run-1" : "run-2",
        async *stream() {
          if (!rejected && failure === undefined) {
            yield { type: "assistant", message: { content: [{ type: "text", text: "Hello." }] } };
          }
        },
        wait() {
          if (failure) {
            return Promise.resolve({ status: "error" as const, error: { message: failure } });
          }
          if (rejected) {
            return Promise.resolve({ status: "error" as const, error: { message: SYSTEM_PROMPT_ERROR } });
          }
          return Promise.resolve({ status: "finished" as const, result: "Hello." });
        },
      };
    },
    async dispose() {
      onDispose();
    },
  };
}
