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
  steer?: SteerAck;
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
    return Promise.resolve(new FakeAgent(this, request.customTools));
  }

  resume(request: ResumeAgentRequest): Promise<RuntimeAgent> {
    this.resumes.push(request);
    return Promise.resolve(new FakeAgent(this, request.customTools));
  }

  openRun(prompt: string, customTools?: Record<string, RuntimeCustomTool>): RuntimeRun {
    const script = resolveScript(this.script, prompt);
    this.sentPrompts.push(prompt);
    this.nextRunId += 1;
    return new FakeRun(script, `fake-run-${this.nextRunId}`, prompt, this, customTools);
  }
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

  constructor(
    private readonly runtime: FakeRuntime,
    private readonly customTools: Record<string, RuntimeCustomTool> | undefined,
  ) {}

  send(prompt: string): Promise<RuntimeRun> {
    return Promise.resolve(this.runtime.openRun(prompt, this.customTools));
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
      return { status: "cancelled", text: streamed };
    }
    if (this.script.status === "error") {
      return { status: "error", text: streamed, error: this.script.error ?? "Run failed" };
    }
    return { status: "finished", text: this.script.result ?? streamed };
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
