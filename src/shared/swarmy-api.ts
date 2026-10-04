import type { EngineStatus } from "./protocol";
import type {
  ApprovalDecision,
  BoardTask,
  PlannerWorker,
  PendingApproval,
  RunDone,
  RunForkResult,
  RunHistoryDetail,
  RunHistoryEntry,
  RunCheckpoint,
  RunStart,
  RunUpdate,
  SteerDelivery,
  WorkflowRunResult,
} from "./runs";
import type { ConnectionInfo, HelloInfo } from "./settings";
import type { McpListToolsPayload } from "./mcp";
import type { Workflow } from "./workflow";
import type { WorkflowSummary } from "./workflows";

export interface SwarmyApi {
  engine: {
    onStatus(listener: (status: EngineStatus) => void): () => void;
  };
  files: {
    pathForFile(file: File): string;
  };
  mcp: {
    saveHeaders(headers: Record<string, string>, secretId?: string): Promise<string>;
    readHeaders(secretId: string): Promise<Record<string, string>>;
    listTools(request: McpListToolsPayload): Promise<string[]>;
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
    history(workflowId: string): Promise<RunHistoryEntry[]>;
    openHistory(threadId: string): Promise<RunHistoryDetail>;
    refreshHistory(threadId: string): Promise<RunHistoryDetail>;
    checkpoints(workflow: Workflow, threadId: string): Promise<RunCheckpoint[]>;
    fork(workflow: Workflow, threadId: string, checkpointId: string): Promise<RunForkResult>;
    onUpdate(listener: (update: RunUpdate) => void): () => void;
    onBoard(listener: (tasks: BoardTask[]) => void): () => void;
    onPlanner(listener: (workers: PlannerWorker[]) => void): () => void;
  };
}
