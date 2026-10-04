import { randomUUID } from "node:crypto";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Annotation, END, isGraphInterrupt, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { Workflow, WorkflowNode } from "@shared/workflow";
import { validateWorkflow } from "@shared/validate-workflow";
import { startAgentRun, type AgentRunSession } from "./agent-run";
import { openRunCatalog, type RunCatalog } from "./run-catalog";
import type { AgentRuntime, RuntimeCustomTool, RuntimeMcpServer, SteerAck } from "./runtime";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import type { WorkspaceManager } from "./workspace-manager";

const handoffPayloadSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  blockers: z.array(z.string()),
});

export interface Handoff {
  kind: "structured" | "unstructured";
  summary: string;
  files: string[];
  blockers: string[];
}

export interface NodeSnapshot {
  status: "completed" | "failed" | "cancelled";
  handoff: Handoff;
}

const GraphState = Annotation.Root({
  snapshots: Annotation<Record<string, NodeSnapshot>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

type GraphValues = typeof GraphState.State;

export interface WorkflowRunUpdate {
  nodeId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  log: string;
  workspacePath?: string;
}

export interface WorkflowRunResult {
  statuses: Record<string, WorkflowRunUpdate["status"]>;
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
  onUpdate?: (update: WorkflowRunUpdate) => void;
}

export interface WorkflowRunHandle {
  threadId: string;
  done: Promise<WorkflowRunResult>;
  cancel(): Promise<void>;
  cancelNode(nodeId: string): Promise<void>;
  steer(nodeId: string, text: string): Promise<SteerAck>;
}

const emptyMcpServers: Record<string, RuntimeMcpServer> = {};

export function startWorkflowRun(input: WorkflowRunInput): WorkflowRunHandle {
  const threadId = input.threadId ?? randomUUID();
  const sessions = new Map<string, AgentRunSession>();
  const cancelledNodes = new Set<string>();
  let runCancelled = false;

  const done = executeGraph();

  return {
    threadId,
    done,
    cancel() {
      runCancelled = true;
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
      ...(input.onUpdate ? { onUpdate: input.onUpdate } : {}),
      sessions,
      isCancelled: () => runCancelled,
      isNodeCancelled: (nodeId) => cancelledNodes.has(nodeId),
    };

    try {
      const incoming = predecessors(workflow);
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
      const outgoing = new Set(workflow.edges.map((edge) => edge.source));
      for (const node of workflow.nodes) {
        if (!outgoing.has(node.id)) {
          graph.addEdge(node.id, END);
        }
      }

      const compiled = graph.compile({ checkpointer: input.checkpointer ?? new MemorySaver() });
      const threadConfig = { configurable: { thread_id: threadId } };
      const prior = input.resume ? (await compiled.getState(threadConfig)).values.snapshots : {};
      for (const node of workflow.nodes) {
        const existing = prior[node.id];
        if (existing) {
          input.onUpdate?.({ nodeId: node.id, status: existing.status, log: existing.handoff.summary });
        } else {
          input.onUpdate?.({ nodeId: node.id, status: "queued", log: "" });
        }
      }

      let finalState: GraphValues;
      let unfinished = false;
      try {
        finalState = await compiled.invoke(input.resume ? null : { snapshots: {} }, {
          ...threadConfig,
          ...(input.interruptAfter ? { interruptAfter: input.interruptAfter } : {}),
        });
        unfinished = wasInterrupted(finalState) || (await compiled.getState(threadConfig)).next.length > 0;
      } catch (error) {
        if (!isGraphInterrupt(error)) {
          throw error;
        }
        unfinished = true;
        finalState = (await compiled.getState(threadConfig)).values;
      }

      const statuses: WorkflowRunResult["statuses"] = {};
      const snapshots = finalState.snapshots ?? {};
      for (const node of workflow.nodes) {
        const snapshot = snapshots[node.id];
        if (snapshot) {
          statuses[node.id] = snapshot.status;
        } else if (unfinished) {
          statuses[node.id] = prior[node.id]?.status ?? "queued";
        } else {
          statuses[node.id] = "failed";
        }
      }
      if (!unfinished) {
        catalog?.markFinished(threadId, overallStatus(statuses, runCancelled));
      }
      return { statuses };
    } catch (error) {
      catalog?.markFinished(threadId, "failed");
      throw error;
    } finally {
      catalog?.close();
    }
  }
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
  onUpdate?: (update: WorkflowRunUpdate) => void;
  sessions: Map<string, AgentRunSession>;
  isCancelled: () => boolean;
  isNodeCancelled: (nodeId: string) => boolean;
}

async function executeNode(
  input: RunContext,
  workflow: Workflow,
  node: WorkflowNode,
  parents: readonly string[],
  state: GraphValues,
): Promise<{ snapshots: Record<string, NodeSnapshot> }> {
  if (input.isCancelled() || input.isNodeCancelled(node.id)) {
    return cancelledSnapshot(input, node.id);
  }

  const upstream = parents.map((id) => state.snapshots[id]);
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
    return { snapshots: { [node.id]: { status: "failed", handoff } } };
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

  const completed = upstream.filter((snapshot): snapshot is NodeSnapshot => snapshot !== undefined);
  const preface = completed
    .map((snapshot) => snapshot.handoff.summary)
    .filter((summary) => summary.length > 0)
    .join("\n");
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

    const prompt = agentPrompt(node.data.taskPrompt ?? "", completed.map((snapshot) => snapshot.handoff));
    const savedAgentId = input.catalog?.agentId(input.threadId, node.id);
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
    if (workspace) {
      await input.workspaces.teardown(workspace).catch(() => undefined);
    }
  }
}

interface SwarmGraph {
  addNode(
    id: string,
    action: (state: GraphValues) => Promise<{ snapshots: Record<string, NodeSnapshot> }>,
    options?: { defer?: boolean },
  ): void;
  addEdge(start: string, end: string): void;
  compile(options: { checkpointer: BaseCheckpointSaver }): CompiledSwarm;
}

interface CompiledSwarm {
  invoke(
    input: { snapshots: Record<string, NodeSnapshot> } | null,
    config: { configurable: { thread_id: string }; interruptAfter?: string[] },
  ): Promise<GraphValues>;
  getState(config: { configurable: { thread_id: string } }): Promise<{
    next: string[];
    values: GraphValues;
  }>;
}

function asSwarmGraph(graph: object): SwarmGraph {
  if (!isSwarmGraph(graph)) {
    throw new Error("LangGraph did not return a graph builder");
  }
  return graph;
}

function isSwarmGraph(graph: object): graph is SwarmGraph {
  return "addNode" in graph && "addEdge" in graph && "compile" in graph;
}

function agentPrompt(task: string, upstream: readonly Handoff[]): string {
  const lines = [handoffInstruction, task.trim().length > 0 ? task : "Reply."];
  for (const handoff of upstream) {
    lines.push(
      JSON.stringify({
        summary: handoff.summary,
        files: handoff.files,
        blockers: handoff.blockers,
      }),
    );
  }
  return lines.join("\n\n");
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

function workspaceId(threadId: string, nodeId: string): string {
  const safe = `${threadId}-${nodeId}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "agent";
}

function cancelledSnapshot(
  input: RunContext,
  nodeId: string,
): { snapshots: Record<string, NodeSnapshot> } {
  const handoff: Handoff = {
    kind: "unstructured",
    summary: "The run was cancelled.",
    files: [],
    blockers: [],
  };
  input.onUpdate?.({ nodeId, status: "cancelled", log: handoff.summary });
  return { snapshots: { [nodeId]: { status: "cancelled", handoff } } };
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
): "completed" | "cancelled" | "failed" {
  if (cancelled || Object.values(statuses).some((status) => status === "cancelled")) {
    return "cancelled";
  }
  if (Object.values(statuses).some((status) => status === "failed")) {
    return "failed";
  }
  return "completed";
}
