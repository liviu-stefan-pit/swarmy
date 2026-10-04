import type { BoardTask } from "@shared/runs";
import type {
  AgentRuntime,
  CreateAgentRequest,
  HelloRequest,
  HelloResult,
  ResumeAgentRequest,
  RuntimeAccount,
  RuntimeAgent,
  RuntimeCustomTool,
  RuntimeEvent,
  RuntimeModel,
  RuntimeRun,
  RuntimeCost,
  RuntimeRunResult,
  SteerAck,
} from "./runtime";

export interface FakePromptScript {
  chunks: readonly string[];
  status?: "finished" | "error" | "cancelled";
  result?: string;
  error?: string;
  hold?: boolean;
  handoff?: Record<string, unknown>;
  /** One `submit_plan` payload. `plans` calls the tool once per entry. */
  plan?: unknown;
  plans?: readonly unknown[];
  task?: BoardTask;
  steer?: SteerAck;
  usage?: {
    totalTokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /** Present only when this script reports a cost, including a real zero. */
  chargedCents?: number;
}

export interface FakeRuntimeScript {
  accountLabel: string;
  models: RuntimeModel[];
  helloText: string;
  prompts?: Record<string, FakePromptScript>;
  defaultPrompt?: FakePromptScript;
}

export const FAKE_RUN_TEXT = "fake-agent-reply";

export class FakeRuntime implements AgentRuntime {
  disposeCount = 0;
  readonly sentPrompts: string[] = [];
  readonly finishedPrompts: string[] = [];
  readonly resumes: ResumeAgentRequest[] = [];
  readonly planReplies: string[] = [];
  readonly created: CreateAgentRequest[] = [];
  private nextRunId = 0;
  private readonly heldRuns: FakeRun[] = [];

  constructor(private readonly script: FakeRuntimeScript) {}

  releaseHeld(): void {
    const held = this.heldRuns.splice(0);
    for (const run of held) {
      run.releaseHold();
    }
  }

  noteFinished(prompt: string): void {
    this.finishedPrompts.push(prompt);
  }

  hold(run: FakeRun): void {
    this.heldRuns.push(run);
  }

  account(apiKey: string): Promise<RuntimeAccount> {
    void apiKey;
    return Promise.resolve({ label: this.script.accountLabel });
  }

  models(apiKey: string): Promise<RuntimeModel[]> {
    void apiKey;
    return Promise.resolve(this.script.models.map((model) => ({ id: model.id })));
  }

  hello(request: HelloRequest): Promise<HelloResult> {
    void request;
    return Promise.resolve({
      text: this.script.helloText,
      systemPromptAccepted: true,
    });
  }

  create(request: CreateAgentRequest): Promise<RuntimeAgent> {
    this.created.push(request);
    return Promise.resolve(new FakeAgent(this, request.customTools));
  }

  resume(request: ResumeAgentRequest): Promise<RuntimeAgent> {
    this.resumes.push(request);
    return Promise.resolve(new FakeAgent(this, request.customTools));
  }

  usageForAgent(apiKey: string, agentId: string): Promise<RuntimeCost> {
    void apiKey;
    void agentId;
    return Promise.resolve({});
  }

  scriptFor(prompt: string): FakePromptScript {
    return resolveScript(this.script, prompt);
  }

  openRun(prompt: string, customTools?: Record<string, RuntimeCustomTool>): RuntimeRun {
    const script = resolveScript(this.script, prompt);
    this.sentPrompts.push(prompt);
    this.nextRunId += 1;
    return new FakeRun(script, `fake-run-${this.nextRunId}`, prompt, this, customTools);
  }
}

function withScriptUsage(result: RuntimeRunResult, script: FakePromptScript): RuntimeRunResult {
  if (!script.usage) {
    return result;
  }
  const usage = script.usage;
  return {
    ...result,
    usage: {
      totalTokens: usage.totalTokens,
      ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
      ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    },
  };
}

function resolveScript(script: FakeRuntimeScript, prompt: string): FakePromptScript {
  const prompts = script.prompts ?? {};
  const exact = prompts[prompt];
  if (exact) {
    return exact;
  }
  const included = Object.keys(prompts)
    .filter((key) => prompt.includes(key))
    .sort((left, right) => right.length - left.length);
  const match = included[0];
  if (match) {
    const found = prompts[match];
    if (found) {
      return found;
    }
  }
  if (script.defaultPrompt) {
    return script.defaultPrompt;
  }
  throw new Error(`No fake script for prompt: ${prompt}`);
}

class FakeAgent implements RuntimeAgent {
  readonly agentId = "fake-agent";
  private disposed = false;
  private reportedCost = false;
  private chargedCents: number | undefined;

  constructor(
    private readonly runtime: FakeRuntime,
    private readonly customTools: Record<string, RuntimeCustomTool> | undefined,
  ) {}

  send(prompt: string): Promise<RuntimeRun> {
    const script = this.runtime.scriptFor(prompt);
    this.reportedCost = Object.hasOwn(script, "chargedCents");
    this.chargedCents = script.chargedCents;
    return Promise.resolve(this.runtime.openRun(prompt, this.customTools));
  }

  getUsage(): Promise<RuntimeCost> {
    if (!this.reportedCost || this.chargedCents === undefined) {
      return Promise.resolve({});
    }
    return Promise.resolve({ chargedCents: this.chargedCents });
  }

  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.runtime.disposeCount += 1;
    }
    return Promise.resolve();
  }
}

export class FakeRun implements RuntimeRun {
  private cancelled = false;
  private released = false;
  private gate: Promise<void>;
  private release: () => void = () => undefined;

  constructor(
    private readonly script: FakePromptScript,
    readonly id: string,
    private readonly prompt: string,
    private readonly runtime: FakeRuntime,
    private readonly customTools: Record<string, RuntimeCustomTool> | undefined,
  ) {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
    if (script.hold) {
      runtime.hold(this);
    }
  }

  releaseHold(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.release();
  }

  async *stream(): AsyncIterable<RuntimeEvent> {
    const taskTool = this.customTools?.update_task;
    const scriptedTask = this.script.task;
    if (scriptedTask && taskTool) {
      const args: Record<string, unknown> = {
        id: scriptedTask.id,
        owner: scriptedTask.owner,
        status: scriptedTask.status,
        summary: scriptedTask.summary,
      };
      await taskTool.execute(args);
      yield { type: "tool", name: "update_task", status: "completed" };
    }
    const planTool = this.customTools?.submit_plan;
    const payloads = this.script.plans ?? (this.script.plan !== undefined ? [this.script.plan] : []);
    if (planTool) {
      for (const payload of payloads) {
        const args =
          payload !== null && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : { value: payload };
        const reply = await planTool.execute(args);
        this.runtime.planReplies.push(typeof reply === "string" ? reply : JSON.stringify(reply));
        yield { type: "tool", name: "submit_plan", status: "completed" };
      }
    }
    const tool = this.customTools?.submit_handoff;
    if (this.script.handoff && tool) {
      await tool.execute(this.script.handoff);
      yield { type: "tool", name: "submit_handoff", status: "completed" };
    }
    for (const text of this.script.chunks) {
      yield { type: "assistant", text };
    }
    if (this.script.hold) {
      await this.gate;
    }
  }

  async wait(): Promise<RuntimeRunResult> {
    const streamed = this.script.chunks.join("");
    if (this.script.hold) {
      await this.gate;
    }
    this.runtime.noteFinished(this.prompt);
    if (this.cancelled || this.script.status === "cancelled") {
      return withScriptUsage({ status: "cancelled", text: streamed }, this.script);
    }
    if (this.script.status === "error") {
      return withScriptUsage(
        { status: "error", text: streamed, error: this.script.error ?? "Run failed" },
        this.script,
      );
    }
    return withScriptUsage({ status: "finished", text: this.script.result ?? streamed }, this.script);
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    this.releaseHold();
    return Promise.resolve();
  }

  steer(text: string): Promise<SteerAck> {
    void text;
    return Promise.resolve(this.script.steer ?? "complete_delivered");
  }
}
