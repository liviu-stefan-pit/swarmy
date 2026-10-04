import type { EngineStatus } from "./protocol";
import type {
  ApprovalDecision,
  PendingApproval,
  RunDone,
  RunStart,
  RunUpdate,
  SteerDelivery,
  WorkflowRunResult,
} from "./runs";
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
  runs: {
    start(input: RunStart): Promise<RunDone>;
    startWorkflow(workflow: Workflow): Promise<WorkflowRunResult>;
    resume(workflow: Workflow, threadId: string, decision?: ApprovalDecision): Promise<WorkflowRunResult>;
    pendingApprovals(workflow: Workflow, threadId: string): Promise<PendingApproval[]>;
    decide(decision: ApprovalDecision): Promise<void>;
    cancel(nodeId: string): Promise<void>;
    cancelWorkflow(): Promise<void>;
    steer(nodeId: string, text: string): Promise<SteerDelivery>;
    unfinished(workflowId: string): Promise<string | null>;
    onUpdate(listener: (update: RunUpdate) => void): () => void;
  };
}
