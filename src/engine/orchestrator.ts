import { randomUUID } from "node:crypto";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  Annotation,
  Command,
  END,
  interrupt,
  isGraphInterrupt,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";
import {
  approvalDecisionSchema,
  budgetExceededMessage,
  pendingApprovalSchema,
  type ApprovalDecision,
  type PendingApproval,
} from "@shared/runs";
import type { Workflow, WorkflowNode } from "@shared/workflow";
import { validateWorkflow } from "@shared/validate-workflow";
import { startAgentRun, type AgentRunSession } from "./agent-run";
import { openRunCatalog, type RunCatalog } from "./run-catalog";
import type { AgentRuntime, RuntimeCustomTool, RuntimeMcpServer, SteerAck } from "./runtime";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { collectWorktreeDiff, commitReviewedEdits, safeRelative } from "./worktree-diff";
import type { AgentWorkspace, WorkspaceManager } from "./workspace-manager";

const handoffPayloadSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  blockers: z.array(z.string()),
});

const resumeDecisionSchema = z.union([
  z.object({
    action: z.literal("approve"),
    files: approvalDecisionSchema.shape.files,
  }),
  z.object({ action: z.literal("reject"), reason: z.string() }),
]);

const maxRejectCycles = 3;

export interface Handoff {
  kind: "structured" | "unstructured";
  summary: string;
  files: string[];
  blockers: string[];
  texts?: Record<string, string>;
}

export interface NodeSnapshot {
  status: "completed" | "failed" | "cancelled";
  handoff: Handoff;
}

type ApprovalRoute = "approve" | "reject" | "fail";

const GraphState = Annotation.Root({
  snapshots: Annotation<Record<string, NodeSnapshot>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  rejectCounts: Annotation<Record<string, number>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  feedback: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  routes: Annotation<Record<string, ApprovalRoute>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

type GraphValues = typeof GraphState.State;

export type { ApprovalDecision, PendingApproval };

export interface WorkflowRunUpdate {
  nodeId: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  log: string;
  workspacePath?: string;
  files?: PendingApproval["files"];
}

export interface WorkflowRunResult {
  statuses: Record<string, WorkflowRunUpdate["status"]>;
  runStatus: "running" | "completed" | "cancelled" | "failed" | "budget_exceeded";
  budgetNote?: string;
}

const handoffInstruction =
  "When you finish, call submit_handoff. Its payload has summary, files, and blockers.";

export interface WorkflowRunInput {
  workflow: Workflow;
  runtime: AgentRuntime;
  apiKey: string;
  workspaces: WorkspaceManager;
  checkpointer?: BaseCheckpointSaver;
  threadId?: string;
  interruptAfter?: string[];
  resume?: boolean;
  decision?: ApprovalDecision;
  onUpdate?: (update: WorkflowRunUpdate) => void;
}

export interface WorkflowRunHandle {
  threadId: string;
  done: Promise<WorkflowRunResult>;
  pendingApprovals(): PendingApproval[];
  decide(decision: ApprovalDecision): Promise<void>;
  cancel(): Promise<void>;
  cancelNode(nodeId: string): Promise<void>;
  steer(nodeId: string, text: string): Promise<SteerAck>;
}

const emptyMcpServers: Record<string, RuntimeMcpServer> = {};
const emptyState = {
  snapshots: {},
  rejectCounts: {},
  feedback: {},
  routes: {},
} satisfies GraphValues;

export function startWorkflowRun(input: WorkflowRunInput): WorkflowRunHandle {
  const threadId = input.threadId ?? randomUUID();
  const sessions = new Map<string, AgentRunSession>();
  const retained = new Map<string, AgentWorkspace>();
  const cancelledNodes = new Set<string>();
  const waiting: PendingApproval[] = [];
  let runCancelled = false;
  let budgetExceeded = false;
  let budgetNote = "";
  let knownTokens = 0;
  let decisionWaiter: ((decision: ApprovalDecision | undefined) => void) | undefined;

  const done = executeGraph();

  return {
    threadId,
    done,
    pendingApprovals() {
      return waiting.map((item) => ({
        nodeId: item.nodeId,
        summary: item.summary,
        files: item.files,
        ...(item.workspacePath ? { workspacePath: item.workspacePath } : {}),
      }));
    },
    decide(decision) {
      const waiter = decisionWaiter;
      if (!waiter) {
        return Promise.reject(new Error("No approval is waiting"));
      }
      if (!waiting.some((item) => item.nodeId === decision.nodeId)) {
        return Promise.reject(new Error("That approval is not waiting"));
      }
      if (decision.action === "reject" && (decision.reason ?? "").trim().length === 0) {
        return Promise.reject(new Error("A rejection needs a reason"));
      }
      decisionWaiter = undefined;
      waiting.splice(0, waiting.length);
      waiter(decision);
      return Promise.resolve();
    },
    cancel() {
      runCancelled = true;
      releaseWaiter();
      return cancelSessions([...sessions.values()]);
    },
    cancelNode(nodeId) {
      cancelledNodes.add(nodeId);
      const session = sessions.get(nodeId);
      return session ? session.cancel() : Promise.resolve();
    },
    steer(nodeId, text) {
      const session = sessions.get(nodeId);
      if (!session) {
        return Promise.reject(new Error("That agent is not running"));
      }
      return session.steer(text);
    },
  };

  function releaseWaiter(): void {
    const waiter = decisionWaiter;
    decisionWaiter = undefined;
    waiting.splice(0, waiting.length);
    waiter?.(undefined);
  }

  function waitForDecision(): Promise<ApprovalDecision | undefined> {
    return new Promise((resolve) => {
      decisionWaiter = resolve;
    });
  }

  async function executeGraph(): Promise<WorkflowRunResult> {
    const { workflow } = validateWorkflow(input.workflow);
    const catalog = catalogFor(input.checkpointer);
    catalog?.markRunning(threadId, workflow.id);
    const context: RunContext = {
      runtime: input.runtime,
      apiKey: input.apiKey,
      workspaces: input.workspaces,
      threadId,
      ...(catalog ? { catalog } : {}),
      ...(workflow.budgetTokens !== undefined ? { budgetTokens: workflow.budgetTokens } : {}),
      ...(input.onUpdate ? { onUpdate: input.onUpdate } : {}),
      sessions,
      retained,
      isCancelled: () => runCancelled,
      isNodeCancelled: (nodeId) => cancelledNodes.has(nodeId),
      isBudgetExceeded: () => budgetExceeded,
      budgetNote: () => budgetNote,
      noteBudgetStop(message) {
        budgetNote = message;
      },
      async markBudgetExceeded() {
        budgetExceeded = true;
        await cancelSessions([...sessions.values()]);
      },
      noteTokens(tokens) {
        if (catalog || tokens === undefined) {
          return;
        }
        knownTokens += tokens;
      },
      spentTokens() {
        return catalog ? catalog.knownTotalTokens(threadId) : knownTokens;
      },
    };

    try {
      const checkpointer = input.checkpointer ?? new MemorySaver();
      const compiled = compileSwarm(workflow, context, checkpointer);
      const threadConfig = { configurable: { thread_id: threadId } };
      const prior = input.resume ? (await compiled.getState(threadConfig)).values.snapshots ?? {} : {};
      for (const node of workflow.nodes) {
        const existing = prior[node.id];
        if (existing) {
          input.onUpdate?.({ nodeId: node.id, status: existing.status, log: existing.handoff.summary });
        } else {
          input.onUpdate?.({ nodeId: node.id, status: "queued", log: "" });
        }
      }

      let step: StepInput = input.resume ? null : emptyState;
      if (input.decision && !runCancelled) {
        step = new Command({ resume: resumeValue(input.decision) });
      } else if (input.resume) {
        const existing = await compiled.getState(threadConfig);
        const pending = readPending(existing);
        if (pending.length > 0) {
          publish(pending);
          const decision = await waitForDecision();
          if (decision && !runCancelled) {
            step = new Command({ resume: resumeValue(decision) });
          }
        }
      }

      let finalState: GraphValues = emptyState;
      let unfinished = false;
      while (!runCancelled) {
        try {
          finalState = await compiled.invoke(step, {
            ...threadConfig,
            ...(input.interruptAfter && !isResumeCommand(step) ? { interruptAfter: input.interruptAfter } : {}),
          });
        } catch (error) {
          if (!isGraphInterrupt(error)) {
            throw error;
          }
          const pending = approvalsFromValues(error.interrupts.map((item) => item.value));
          const snapshot = await compiled.getState(threadConfig);
          finalState = snapshot.values ?? finalState;
          if (pending.length === 0) {
            unfinished = true;
            break;
          }
          publish(pending);
          const decision = await waitForDecision();
          if (!decision || runCancelled) {
            break;
          }
          step = new Command({ resume: resumeValue(decision) });
          continue;
        }

        const snapshot = await compiled.getState(threadConfig);
        finalState = snapshot.values ?? finalState;
        const pending = readPending(snapshot);
        if (pending.length > 0) {
          publish(pending);
          const decision = await waitForDecision();
          if (!decision || runCancelled) {
            break;
          }
          step = new Command({ resume: resumeValue(decision) });
          continue;
        }

        unfinished = wasInterrupted(finalState) || snapshot.next.length > 0;
        break;
      }

      const statuses: WorkflowRunResult["statuses"] = {};
      const snapshots = finalState.snapshots ?? {};
      const incoming = predecessors(workflow);
      for (const node of workflow.nodes) {
        const snapshot = snapshots[node.id];
        if (snapshot) {
          statuses[node.id] = snapshot.status;
        } else if (unfinished) {
          statuses[node.id] = prior[node.id]?.status ?? "queued";
        } else if (
          runCancelled ||
          budgetExceeded ||
          parentStatus(node.id, snapshots, incoming) === "cancelled"
        ) {
          statuses[node.id] = "cancelled";
        } else {
          statuses[node.id] = "failed";
        }
      }
      if (unfinished) {
        return { statuses, runStatus: "running" };
      }
      const runStatus = overallStatus(statuses, runCancelled, budgetExceeded);
      catalog?.markFinished(threadId, runStatus);
      return { statuses, runStatus, ...(budgetNote ? { budgetNote } : {}) };
    } catch (error) {
      catalog?.markFinished(threadId, "failed");
      throw error;
    } finally {
      catalog?.close();
    }
  }

  function publish(items: readonly PendingApproval[]): void {
    waiting.splice(
      0,
      waiting.length,
      ...items.map((item) => ({
        nodeId: item.nodeId,
        summary: item.summary,
        files: item.files,
        ...(item.workspacePath ? { workspacePath: item.workspacePath } : {}),
      })),
    );
  }
}

export function listPendingApprovals(input: {
  workflow: Workflow;
  checkpointer: BaseCheckpointSaver;
  threadId: string;
}): Promise<PendingApproval[]> {
  const { workflow } = validateWorkflow(input.workflow);
  const compiled = compileSwarm(workflow, idleContext(input.threadId), input.checkpointer);
  return compiled.getState({ configurable: { thread_id: input.threadId } }).then((state) => readPending(state));
}

export function runWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult> {
  return startWorkflowRun(input).done;
}

export function resumeWorkflow(input: WorkflowRunInput & { threadId: string }): Promise<WorkflowRunResult> {
  return startWorkflowRun({ ...input, resume: true }).done;
}

interface RunContext {
  runtime: AgentRuntime;
  apiKey: string;
  workspaces: WorkspaceManager;
  threadId: string;
  catalog?: RunCatalog;
  budgetTokens?: number;
  onUpdate?: (update: WorkflowRunUpdate) => void;
  sessions: Map<string, AgentRunSession>;
  retained: Map<string, AgentWorkspace>;
  isCancelled: () => boolean;
  isNodeCancelled: (nodeId: string) => boolean;
  isBudgetExceeded: () => boolean;
  budgetNote: () => string;
  noteBudgetStop: (message: string) => void;
  markBudgetExceeded: () => Promise<void>;
  noteTokens: (tokens: number | undefined) => void;
  spentTokens: () => number;
}

type NodeUpdate = Partial<GraphValues>;

async function executeNode(
  input: RunContext,
  workflow: Workflow,
  node: WorkflowNode,
  parents: readonly string[],
  state: GraphValues,
): Promise<NodeUpdate> {
  if (input.isCancelled() || input.isNodeCancelled(node.id)) {
    return cancelledSnapshot(input, node.id);
  }
  if (input.isBudgetExceeded()) {
    return budgetSnapshot(input, node.id);
  }

  const upstream = parents.map((id) => state.snapshots?.[id]);
  if (upstream.some((snapshot) => !snapshot || snapshot.status !== "completed")) {
    const cancelled =
      input.isCancelled() || upstream.some((snapshot) => snapshot?.status === "cancelled");
    if (cancelled) {
      return cancelledSnapshot(input, node.id);
    }
    const handoff: Handoff = {
      kind: "unstructured",
      summary: "An upstream node failed.",
      files: [],
      blockers: [],
    };
    const log = handoff.summary;
    input.onUpdate?.({ nodeId: node.id, status: "failed", log });
    return { snapshots: { [node.id]: { status: "failed", handoff } }, routes: { [node.id]: "fail" } };
  }

  if (node.type === "approval") {
    return executeApproval(input, workflow, node, parents, state);
  }

  if (node.type !== "agent") {
    const handoff: Handoff = {
      kind: "unstructured",
      summary: node.data.label,
      files: [],
      blockers: [],
    };
    input.onUpdate?.({ nodeId: node.id, status: "running", log: "" });
    input.onUpdate?.({ nodeId: node.id, status: "completed", log: handoff.summary });
    return { snapshots: { [node.id]: { status: "completed", handoff } } };
  }

  return executeAgent(input, workflow, node, state);
}

async function executeApproval(
  input: RunContext,
  workflow: Workflow,
  node: WorkflowNode,
  parents: readonly string[],
  state: GraphValues,
): Promise<NodeUpdate> {
  const completed = parents
    .map((id) => state.snapshots?.[id])
    .filter((snapshot): snapshot is NodeSnapshot => snapshot !== undefined);
  const summary = approvalSummary(node, completed);
  const reviewed = await reviewFiles(input, workflow, parents);
  const files = reviewed.map((file) => ({ path: file.path, original: file.original, modified: file.modified }));
  const workspacePath = reviewed[0]?.workspacePath;
  input.onUpdate?.({
    nodeId: node.id,
    status: "waiting",
    log: summary,
    ...(files.length > 0 ? { files } : {}),
    ...(workspacePath ? { workspacePath } : {}),
  });
  const raw = interrupt({
    nodeId: node.id,
    summary,
    files,
    ...(workspacePath ? { workspacePath } : {}),
  });
  const parsed = resumeDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return failedApproval(input, node.id, "The approval decision was not understood.");
  }
  if (parsed.data.action === "approve") {
    const texts: Record<string, string> = {};
    let committed: string[];
    try {
      const edits = parsed.data.files ?? [];
      for (const edit of edits) {
        texts[safeRelative(edit.path)] = edit.text;
      }
      committed = await commitReview(reviewed, edits);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "The diff could not be committed";
      return failedApproval(input, node.id, message);
    }
    const handoff = combinedHandoff(completed, summary);
    const next: Handoff = {
      ...handoff,
      ...(committed.length > 0 ? { files: committed } : {}),
      ...(Object.keys(texts).length > 0 ? { texts } : {}),
    };
    input.onUpdate?.({ nodeId: node.id, status: "completed", log: next.summary });
    return {
      snapshots: { [node.id]: { status: "completed", handoff: next } },
      routes: { [node.id]: "approve" },
    };
  }

  const count = (state.rejectCounts?.[node.id] ?? 0) + 1;
  if (count > maxRejectCycles) {
    return failedApproval(input, node.id, `Approval stopped after ${maxRejectCycles} reject cycles.`, count);
  }

  const feedback: Record<string, string> = {};
  for (const parentId of parents) {
    feedback[parentId] = parsed.data.reason;
  }
  input.onUpdate?.({ nodeId: node.id, status: "queued", log: parsed.data.reason });
  return {
    rejectCounts: { [node.id]: count },
    feedback,
    routes: { [node.id]: "reject" },
  };
}

async function executeAgent(
  input: RunContext,
  workflow: Workflow,
  node: Extract<WorkflowNode, { type: "agent" }>,
  state: GraphValues,
): Promise<NodeUpdate> {
  const note = state.feedback?.[node.id] ?? "";
  const parents = predecessors(workflow).get(node.id) ?? [];
  const upstream = parents
    .map((id) => state.snapshots?.[id])
    .filter((snapshot): snapshot is NodeSnapshot => snapshot !== undefined && snapshot.status === "completed");
  const summaryText = upstream
    .map((snapshot) => snapshot.handoff.summary)
    .filter((summary) => summary.length > 0)
    .join("\n");
  const preface =
    note.trim().length > 0 ? joinLog(summaryText, `The approval was rejected: ${note.trim()}`) : summaryText;
  const report = (status: WorkflowRunUpdate["status"], log: string, workspacePath?: string): void => {
    input.onUpdate?.({
      nodeId: node.id,
      status,
      log: joinLog(preface, log),
      ...(workspacePath ? { workspacePath } : {}),
    });
  };

  report("running", "");
  let workspace: Awaited<ReturnType<WorkspaceManager["provision"]>> | undefined;
  try {
    const mode = node.data.workspaceMode ?? "managed";
    workspace = await input.workspaces.provision({
      id: workspaceId(input.threadId, node.id),
      mode,
      ...(workflow.repositoryPath ? { repositoryPath: workflow.repositoryPath } : {}),
      ...(node.data.folderPath ? { folderPath: node.data.folderPath } : {}),
    });
    const workspacePath = workspace.path;
    let captured: Handoff | undefined;
    const submitHandoff: RuntimeCustomTool = {
      description: "Record the handoff for downstream nodes.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          blockers: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "files", "blockers"],
      },
      execute(args) {
        const parsed = handoffPayloadSchema.safeParse(args);
        if (!parsed.success) {
          return "handoff payload was not accepted";
        }
        captured = { kind: "structured", ...parsed.data };
        return "handoff recorded";
      },
    };

    const prompt = agentPrompt(
      node.data.taskPrompt ?? "",
      upstream.map((snapshot) => snapshot.handoff),
      note,
    );
    const savedAgentId = note.trim().length > 0 ? undefined : input.catalog?.agentId(input.threadId, node.id);
    const session = startAgentRun({
      runtime: input.runtime,
      request: {
        apiKey: input.apiKey,
        cwd: workspacePath,
        prompt,
        customTools: { submit_handoff: submitHandoff },
        mcpServers: emptyMcpServers,
        ...(node.data.modelId ? { modelId: node.data.modelId } : {}),
        ...(node.data.systemPrompt !== undefined ? { systemPrompt: node.data.systemPrompt } : {}),
        ...(node.data.tools !== undefined ? { tools: node.data.tools } : {}),
        ...(node.data.disallowedTools !== undefined ? { disallowedTools: node.data.disallowedTools } : {}),
        ...(node.data.guardrails !== undefined ? { guardrails: node.data.guardrails } : {}),
        ...(node.data.writePaths !== undefined ? { writePaths: node.data.writePaths } : {}),
        ...(node.data.sandboxEnabled !== undefined ? { sandboxEnabled: node.data.sandboxEnabled } : {}),
        ...(node.data.autoReview !== undefined ? { autoReview: node.data.autoReview } : {}),
        ...(savedAgentId ? { agentId: savedAgentId } : {}),
      },
      onAgent(agentId) {
        input.catalog?.rememberAgent(input.threadId, node.id, agentId);
      },
      onUpdate(update) {
        report(update.status, update.log, workspacePath);
      },
    });
    input.sessions.set(node.id, session);
    if (input.isCancelled() || input.isNodeCancelled(node.id)) {
      await session.cancel();
    }
    const outcome = await session.done;
    rememberNode(input, node.id, outcome.log, outcome.totalTokens, outcome.chargedCents);
    input.noteTokens(outcome.totalTokens);
    const stop = budgetStopFor(input, outcome.status, outcome.totalTokens);
    if (stop) {
      const transcript = joinLog(outcome.log, stop);
      rememberNode(input, node.id, transcript, outcome.totalTokens, outcome.chargedCents);
      input.noteBudgetStop(stop);
      report(outcome.status, transcript, workspacePath);
      await input.markBudgetExceeded();
    }

    const handoff: Handoff = captured ?? {
      kind: "unstructured",
      summary: outcome.text,
      files: [],
      blockers: [],
    };
    return { snapshots: { [node.id]: { status: outcome.status, handoff } } };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "The node failed";
    const handoff: Handoff = { kind: "unstructured", summary: message, files: [], blockers: [] };
    report("failed", message);
    return { snapshots: { [node.id]: { status: "failed", handoff } } };
  } finally {
    input.sessions.delete(node.id);
    if (workspace && keepsWorktree(workflow, node.id)) {
      input.retained.set(node.id, workspace);
    } else if (workspace) {
      await input.workspaces.teardown(workspace).catch(() => undefined);
    }
  }
}

function compileSwarm(workflow: Workflow, context: RunContext, checkpointer: BaseCheckpointSaver): CompiledSwarm {
  const incoming = predecessors(workflow);
  const outgoing = successors(workflow);
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const approvalIds = new Set(workflow.nodes.filter((node) => node.type === "approval").map((node) => node.id));
  const graph = asSwarmGraph(new StateGraph(GraphState));

  for (const node of workflow.nodes) {
    const parents = incoming.get(node.id) ?? [];
    graph.addNode(
      node.id,
      (state) => executeNode(context, workflow, node, parents, state),
      parents.length > 1 ? { defer: true } : {},
    );
  }

  const seen = new Set<string>();
  for (const edge of workflow.edges) {
    if (approvalIds.has(edge.source)) {
      continue;
    }
    const key = `${edge.source}\0${edge.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    graph.addEdge(edge.source, edge.target);
  }

  for (const node of workflow.nodes) {
    if ((incoming.get(node.id) ?? []).length === 0) {
      graph.addEdge(START, node.id);
    }
  }
  for (const node of workflow.nodes) {
    if (approvalIds.has(node.id) || (outgoing.get(node.id) ?? []).length > 0) {
      continue;
    }
    graph.addEdge(node.id, END);
  }

  for (const node of workflow.nodes) {
    if (!approvalIds.has(node.id)) {
      continue;
    }
    const downstream = outgoing.get(node.id) ?? [];
    const upstreamAgents = (incoming.get(node.id) ?? []).filter((id) => nodesById.get(id)?.type === "agent");
    graph.addConditionalEdges(node.id, (state) => {
      const route = state.routes?.[node.id];
      if (route === "approve") {
        return routeTargets(downstream);
      }
      if (route === "reject") {
        return routeTargets(upstreamAgents);
      }
      return END;
    });
  }

  return graph.compile({ checkpointer });
}

interface SwarmGraph {
  addNode(
    id: string,
    action: (state: GraphValues) => Promise<NodeUpdate> | NodeUpdate,
    options?: { defer?: boolean },
  ): void;
  addEdge(start: string, end: string): void;
  addConditionalEdges(source: string, path: (state: GraphValues) => string | string[]): void;
  compile(options: { checkpointer: BaseCheckpointSaver }): CompiledSwarm;
}

type StepInput = GraphValues | Command | null;

interface CompiledSwarm {
  invoke(
    input: StepInput,
    config: { configurable: { thread_id: string }; interruptAfter?: string[] },
  ): Promise<GraphValues>;
  getState(config: { configurable: { thread_id: string } }): Promise<{
    next: string[];
    values: GraphValues;
    tasks?: { interrupts?: { value?: unknown }[] }[];
  }>;
}

function asSwarmGraph(graph: object): SwarmGraph {
  if (!isSwarmGraph(graph)) {
    throw new Error("LangGraph did not return a graph builder");
  }
  return graph;
}

function isSwarmGraph(graph: object): graph is SwarmGraph {
  return "addNode" in graph && "addEdge" in graph && "addConditionalEdges" in graph && "compile" in graph;
}

function agentPrompt(task: string, upstream: readonly Handoff[], feedback: string): string {
  const lines = [handoffInstruction, task.trim().length > 0 ? task : "Reply."];
  for (const handoff of upstream) {
    lines.push(
      JSON.stringify({
        summary: handoff.summary,
        files: handoff.files,
        blockers: handoff.blockers,
        ...(handoff.texts && Object.keys(handoff.texts).length > 0 ? { texts: handoff.texts } : {}),
      }),
    );
    if (handoff.texts) {
      for (const [path, text] of Object.entries(handoff.texts)) {
        lines.push(path, text);
      }
    }
  }
  if (feedback.trim().length > 0) {
    lines.push(`The approval was rejected: ${feedback.trim()}`);
  }
  return lines.join("\n\n");
}

function approvalSummary(node: WorkflowNode, upstream: readonly NodeSnapshot[]): string {
  const text = upstream
    .map((snapshot) => snapshot.handoff.summary)
    .filter((summary) => summary.length > 0)
    .join("\n");
  return text.length > 0 ? text : node.data.label;
}

function combinedHandoff(upstream: readonly NodeSnapshot[], summary: string): Handoff {
  return {
    kind: upstream.some((snapshot) => snapshot.handoff.kind === "structured") ? "structured" : "unstructured",
    summary,
    files: upstream.flatMap((snapshot) => snapshot.handoff.files),
    blockers: upstream.flatMap((snapshot) => snapshot.handoff.blockers),
  };
}

function failedApproval(input: RunContext, nodeId: string, message: string, count?: number): NodeUpdate {
  const handoff: Handoff = { kind: "unstructured", summary: message, files: [], blockers: [] };
  input.onUpdate?.({ nodeId, status: "failed", log: message });
  return {
    snapshots: { [nodeId]: { status: "failed", handoff } },
    routes: { [nodeId]: "fail" },
    ...(count !== undefined ? { rejectCounts: { [nodeId]: count } } : {}),
  };
}

function joinLog(preface: string, log: string): string {
  if (preface.length === 0) {
    return log;
  }
  if (log.length === 0) {
    return preface;
  }
  return `${preface}\n${log}`;
}

function predecessors(workflow: Workflow): Map<string, string[]> {
  const incoming = new Map<string, string[]>(workflow.nodes.map((node) => [node.id, []]));
  for (const edge of workflow.edges) {
    const list = incoming.get(edge.target);
    if (list && !list.includes(edge.source)) {
      list.push(edge.source);
    }
  }
  return incoming;
}

function successors(workflow: Workflow): Map<string, string[]> {
  const outgoing = new Map<string, string[]>(workflow.nodes.map((node) => [node.id, []]));
  for (const edge of workflow.edges) {
    const list = outgoing.get(edge.source);
    if (list && !list.includes(edge.target)) {
      list.push(edge.target);
    }
  }
  return outgoing;
}

function routeTargets(ids: readonly string[]): string | string[] {
  if (ids.length === 0) {
    return END;
  }
  if (ids.length === 1) {
    return ids[0] ?? END;
  }
  return [...ids];
}

function workspaceId(threadId: string, nodeId: string): string {
  const safe = `${threadId}-${nodeId}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "agent";
}

function rememberNode(
  input: RunContext,
  nodeId: string,
  transcript: string,
  totalTokens: number | undefined,
  chargedCents: number | undefined,
): void {
  input.catalog?.recordNode({
    threadId: input.threadId,
    nodeId,
    transcript,
    totalTokens,
    chargedCents,
  });
}

function budgetStopFor(
  input: RunContext,
  status: WorkflowRunUpdate["status"],
  totalTokens: number | undefined,
): string | undefined {
  if (input.budgetTokens === undefined || input.isCancelled() || status === "cancelled" || totalTokens === undefined) {
    return undefined;
  }
  if (input.spentTokens() > input.budgetTokens) {
    return budgetExceededMessage;
  }
  return undefined;
}

function budgetSnapshot(input: RunContext, nodeId: string): NodeUpdate {
  const summary = input.budgetNote() || budgetExceededMessage;
  const handoff: Handoff = {
    kind: "unstructured",
    summary,
    files: [],
    blockers: [],
  };
  input.onUpdate?.({ nodeId, status: "cancelled", log: summary });
  rememberNode(input, nodeId, summary, undefined, undefined);
  return { snapshots: { [nodeId]: { status: "cancelled", handoff } }, routes: { [nodeId]: "fail" } };
}

function cancelledSnapshot(input: RunContext, nodeId: string): NodeUpdate {
  const handoff: Handoff = {
    kind: "unstructured",
    summary: "The run was cancelled.",
    files: [],
    blockers: [],
  };
  input.onUpdate?.({ nodeId, status: "cancelled", log: handoff.summary });
  return { snapshots: { [nodeId]: { status: "cancelled", handoff } }, routes: { [nodeId]: "fail" } };
}

function cancelSessions(sessions: readonly AgentRunSession[]): Promise<void> {
  return Promise.all(sessions.map((session) => session.cancel())).then(() => undefined);
}

function catalogFor(checkpointer: BaseCheckpointSaver | undefined): RunCatalog | undefined {
  if (checkpointer instanceof SqliteCheckpointer) {
    return openRunCatalog(checkpointer.databasePath);
  }
  return undefined;
}

function wasInterrupted(state: object): boolean {
  return "__interrupt__" in state;
}

function overallStatus(
  statuses: WorkflowRunResult["statuses"],
  cancelled: boolean,
  budgetExceeded: boolean,
): "completed" | "cancelled" | "failed" | "budget_exceeded" {
  if (budgetExceeded) {
    return "budget_exceeded";
  }
  if (cancelled || Object.values(statuses).some((status) => status === "cancelled")) {
    return "cancelled";
  }
  if (Object.values(statuses).some((status) => status === "failed")) {
    return "failed";
  }
  return "completed";
}

function parentStatus(
  nodeId: string,
  snapshots: Record<string, NodeSnapshot>,
  incoming: Map<string, string[]>,
): NodeSnapshot["status"] | undefined {
  const parents = incoming.get(nodeId) ?? [];
  if (parents.some((id) => snapshots[id]?.status === "cancelled")) {
    return "cancelled";
  }
  if (parents.some((id) => snapshots[id]?.status === "failed")) {
    return "failed";
  }
  return undefined;
}

function resumeValue(
  decision: ApprovalDecision,
): { action: "approve"; files?: ApprovalDecision["files"] } | { action: "reject"; reason: string } {
  if (decision.action === "reject") {
    return { action: "reject", reason: (decision.reason ?? "").trim() };
  }
  return {
    action: "approve",
    ...(decision.files && decision.files.length > 0 ? { files: decision.files } : {}),
  };
}

function isResumeCommand(step: StepInput): boolean {
  return step instanceof Command;
}

function readPending(state: {
  values?: GraphValues;
  tasks?: { interrupts?: { value?: unknown }[] }[];
}): PendingApproval[] {
  const fromTasks = (state.tasks ?? []).flatMap((task) =>
    (task.interrupts ?? []).flatMap((item) => approvalsFromValues([item.value])),
  );
  if (fromTasks.length > 0) {
    return fromTasks;
  }
  const values: unknown = state.values;
  if (typeof values === "object" && values !== null && "__interrupt__" in values) {
    const raw = (values as { __interrupt__?: { value?: unknown }[] }).__interrupt__ ?? [];
    return approvalsFromValues(raw.map((item) => item.value));
  }
  return [];
}

function approvalsFromValues(values: readonly unknown[]): PendingApproval[] {
  const items: PendingApproval[] = [];
  for (const value of values) {
    const parsed = pendingApprovalSchema.safeParse(value);
    if (parsed.success) {
      items.push(parsed.data);
    }
  }
  return items;
}

interface ReviewedFile {
  path: string;
  original: string;
  modified: string;
  workspacePath: string;
}

async function reviewFiles(
  input: RunContext,
  workflow: Workflow,
  parents: readonly string[],
): Promise<ReviewedFile[]> {
  const files: ReviewedFile[] = [];
  for (const parentId of parents) {
    const workspace = await agentWorkspace(input, workflow, parentId);
    if (!workspace) {
      continue;
    }
    try {
      const diff = await collectWorktreeDiff(workspace.path);
      for (const file of diff.files) {
        files.push({ ...file, workspacePath: workspace.path });
      }
    } catch {
      // A folder that is not a git worktree has nothing to review.
    }
  }
  return files;
}

async function agentWorkspace(
  input: RunContext,
  workflow: Workflow,
  nodeId: string,
): Promise<AgentWorkspace | undefined> {
  const kept = input.retained.get(nodeId);
  if (kept) {
    return kept;
  }
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== "agent") {
    return undefined;
  }
  const mode = node.data.workspaceMode ?? "managed";
  const located = await input.workspaces.locate({
    id: workspaceId(input.threadId, nodeId),
    mode,
    ...(workflow.repositoryPath ? { repositoryPath: workflow.repositoryPath } : {}),
    ...(node.data.folderPath ? { folderPath: node.data.folderPath } : {}),
  });
  return located ?? undefined;
}

async function commitReview(
  reviewed: readonly ReviewedFile[],
  edits: readonly { path: string; text: string }[],
): Promise<string[]> {
  const byWorkspace = new Map<string, { path: string; text: string }[]>();
  for (const edit of edits) {
    const path = safeRelative(edit.path);
    const home = reviewed.find((file) => file.path === path)?.workspacePath ?? reviewed[0]?.workspacePath;
    if (!home) {
      continue;
    }
    const list = byWorkspace.get(home) ?? [];
    list.push({ path, text: edit.text });
    byWorkspace.set(home, list);
  }
  if (byWorkspace.size === 0) {
    const homes = [...new Set(reviewed.map((file) => file.workspacePath))];
    for (const home of homes) {
      byWorkspace.set(home, []);
    }
  }
  const committed: string[] = [];
  for (const [cwd, files] of byWorkspace) {
    committed.push(...(await commitReviewedEdits(cwd, files)));
  }
  return committed;
}

function keepsWorktree(workflow: Workflow, nodeId: string): boolean {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  return (successors(workflow).get(nodeId) ?? []).some((id) => nodesById.get(id)?.type === "approval");
}

function idleContext(threadId: string): RunContext {
  return {
    runtime: {
      account() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
      models() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
      hello() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
      create() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
      resume() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
      usageForAgent() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
    },
    apiKey: "",
    workspaces: {
      provision() {
        return Promise.reject(new Error("Listing approvals does not run agents"));
      },
      locate() {
        return Promise.resolve(null);
      },
      teardown() {
        return Promise.resolve();
      },
      trackChild() {
        return undefined;
      },
    },
    threadId,
    sessions: new Map(),
    retained: new Map(),
    isCancelled: () => false,
    isNodeCancelled: () => false,
    isBudgetExceeded: () => false,
    budgetNote: () => "",
    noteBudgetStop: () => undefined,
    markBudgetExceeded: () => Promise.resolve(),
    noteTokens: () => undefined,
    spentTokens: () => 0,
  };
}
