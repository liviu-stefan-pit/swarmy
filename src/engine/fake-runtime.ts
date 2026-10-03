import type {
  AgentRuntime,
  CreateAgentRequest,
  HelloRequest,
  HelloResult,
  RuntimeAccount,
  RuntimeAgent,
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
  private nextRunId = 0;

  constructor(private readonly script: FakeRuntimeScript) {}

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
    void request;
    return Promise.resolve(new FakeAgent(this));
  }

  openRun(prompt: string): RuntimeRun {
    const script = this.script.prompts?.[prompt] ?? this.script.defaultPrompt;
    if (!script) {
      throw new Error(`No fake script for prompt: ${prompt}`);
    }
    this.nextRunId += 1;
    return new FakeRun(script, `fake-run-${this.nextRunId}`);
  }
}

class FakeAgent implements RuntimeAgent {
  readonly agentId = "fake-agent";
  private disposed = false;

  constructor(private readonly runtime: FakeRuntime) {}

  send(prompt: string): Promise<RuntimeRun> {
    return Promise.resolve(this.runtime.openRun(prompt));
  }

  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.runtime.disposeCount += 1;
    }
    return Promise.resolve();
  }
}

class FakeRun implements RuntimeRun {
  private cancelled = false;
  private gate: Promise<void>;
  private release: () => void = () => undefined;

  constructor(
    private readonly script: FakePromptScript,
    readonly id: string,
  ) {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  async *stream(): AsyncIterable<RuntimeEvent> {
    for (const text of this.script.chunks) {
      yield { type: "assistant", text };
    }
    if (this.script.hold) {
      await this.gate;
    }
  }

  async wait(): Promise<RuntimeRunResult> {
    const text = this.script.chunks.join("");
    if (this.script.hold || this.cancelled) {
      await this.gate;
      return { status: "cancelled", text };
    }
    if (this.script.status === "error") {
      return { status: "error", text, error: this.script.error ?? "Run failed" };
    }
    if (this.script.status === "cancelled") {
      return { status: "cancelled", text };
    }
    return { status: "finished", text: this.script.result ?? text };
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    this.release();
    return Promise.resolve();
  }

  steer(text: string): Promise<SteerAck> {
    void text;
    return Promise.resolve("complete_delivered");
  }
}
