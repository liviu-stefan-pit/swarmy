import type { AgentRuntime, HelloRequest, HelloResult, RuntimeAccount, RuntimeModel } from "./runtime";

export interface FakeRuntimeScript {
  accountLabel: string;
  models: RuntimeModel[];
  helloText: string;
}

export class FakeRuntime implements AgentRuntime {
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
}
