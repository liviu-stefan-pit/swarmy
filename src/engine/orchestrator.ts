import { randomUUID } from "node:crypto";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { Workflow, WorkflowNode } from "@shared/workflow";
import { validateWorkflow } from "@shared/validate-workflow";
import { startAgentRun } from "./agent-run";
import type { AgentRuntime, RuntimeCustomTool } from "./runtime";
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
  statuses: Record<string, NodeSnapshot["status"]>;
}

const handoffInstruction =
  "When you finish, call submit_handoff. Its payload has summary, files, and blockers.";

export async function runWorkflow(input: {
  workflow: Workflow;
  runtime: AgentRuntime;
  apiKey: string;
  workspaces: WorkspaceManager;
  checkpointer?: BaseCheckpointSaver;
  onUpdate?: (update: WorkflowRunUpdate) => void;
}): Promise<WorkflowRunResult> {
  const { workflow } = validateWorkflow(input.workflow);
  const incoming = predecessors(workflow);
  for (const node of workflow.nodes) {
    input.onUpdate?.({ nodeId: node.id, status: "queued", log: "" });
  }

  const graph = asSwarmGraph(new StateGraph(GraphState));
  for (const node of workflow.nodes) {
    const parents = incoming.get(node.id) ?? [];
    graph.addNode(
      node.id,
      (state) => executeNode(input, workflow, node, parents, state),
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
  const finalState = await compiled.invoke(
    { snapshots: {} },
    { configurable: { thread_id: randomUUID() } },
  );

  const statuses: WorkflowRunResult["statuses"] = {};
  for (const node of workflow.nodes) {
    statuses[node.id] = finalState.snapshots[node.id]?.status ?? "failed";
  }
  return { statuses };
}

async function executeNode(
  input: {
    runtime: AgentRuntime;
    apiKey: string;
    workspaces: WorkspaceManager;
    onUpdate?: (update: WorkflowRunUpdate) => void;
  },
  workflow: Workflow,
  node: WorkflowNode,
  parents: readonly string[],
  state: GraphValues,
): Promise<{ snapshots: Record<string, NodeSnapshot> }> {
  const upstream = parents.map((id) => state.snapshots[id]);
  if (upstream.some((snapshot) => !snapshot || snapshot.status !== "completed")) {
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
      id: workspaceId(node.id),
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
    const outcome = await startAgentRun({
      runtime: input.runtime,
      request: {
        apiKey: input.apiKey,
        cwd: workspacePath,
        prompt,
        customTools: { submit_handoff: submitHandoff },
        ...(node.data.modelId ? { modelId: node.data.modelId } : {}),
        ...(node.data.systemPrompt !== undefined ? { systemPrompt: node.data.systemPrompt } : {}),
        ...(node.data.tools !== undefined ? { tools: node.data.tools } : {}),
        ...(node.data.disallowedTools !== undefined ? { disallowedTools: node.data.disallowedTools } : {}),
      },
      onUpdate(update) {
        report(update.status, update.log, workspacePath);
      },
    }).done;

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
  compile(options: { checkpointer: BaseCheckpointSaver }): {
    invoke(
      input: { snapshots: Record<string, NodeSnapshot> },
      config: { configurable: { thread_id: string } },
    ): Promise<GraphValues>;
  };
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

function workspaceId(nodeId: string): string {
  const safe = nodeId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
  return `${safe}-${randomUUID()}`;
}
