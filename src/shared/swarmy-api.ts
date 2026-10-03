import type { EngineStatus } from "./protocol";
import type { ConnectionInfo, HelloInfo } from "./settings";
import type { Workflow } from "./workflow";
import type { WorkflowSummary } from "./workflows";

export interface SwarmyApi {
  engine: {
    onStatus(listener: (status: EngineStatus) => void): () => void;
  };
  settings: {
    saveKey(apiKey: string): Promise<void>;
    hasKey(): Promise<boolean>;
    testConnection(): Promise<ConnectionInfo>;
    runHello(): Promise<HelloInfo>;
  };
  workflows: {
    list(): Promise<WorkflowSummary[]>;
    load(id: string): Promise<Workflow>;
    save(workflow: Workflow): Promise<WorkflowSummary>;
    delete(id: string): Promise<void>;
  };
}
