import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEngineMessage, type EngineMessage } from "@shared/protocol";
import { budgetExceededMessage } from "@shared/runs";
import { startAgentRun, type AgentRunSession } from "./agent-run";
import { createRuntime } from "./create-runtime";
import { HELLO_PROMPT, HELLO_SYSTEM_PROMPT, type AgentRuntime } from "./runtime";
import { listPendingApprovals, startWorkflowRun, type WorkflowRunHandle } from "./orchestrator";
import { openRunCatalog, unfinishedThread, type RunCatalog } from "./run-catalog";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { openWorkflowDb, workflowDataDir, type WorkflowDb } from "./workflow-db";
import { createWorkspaceManager, type AgentWorkspace, type WorkspaceManager } from "./workspace-manager";

export interface EnginePort {
  postMessage(message: EngineMessage): void;
  onMessage(listener: (message: unknown) => void): void;
}

export function attachEngine(
  port: EnginePort,
  runtime?: AgentRuntime,
  options?: { workspaces?: WorkspaceManager },
): void {
  let runtimePromise: Promise<AgentRuntime> | undefined;
  let workflows: WorkflowDb | undefined;
  let workspaces = options?.workspaces;
  const getWorkspaces = (): WorkspaceManager => {
    workspaces ??= createWorkspaceManager();
    return workspaces;
  };
  const getRuntime = (): Promise<AgentRuntime> => {
    if (runtime) {
      return Promise.resolve(runtime);
    }
    runtimePromise ??= createRuntime();
    return runtimePromise;
  };
  const getWorkflows = (): WorkflowDb => {
    workflows ??= openWorkflowDb(workflowDataDir());
    return workflows;
  };

  const activeRuns = new Map<string, AgentRunSession>();
  const starting = new Set<string>();
  const pendingCancels = new Set<string>();
  let graphRunning = false;
  let workflowHandle: WorkflowRunHandle | undefined;
  let checkpoints: SqliteCheckpointer | undefined;
  const getCheckpointer = (): SqliteCheckpointer => {
    checkpoints ??= SqliteCheckpointer.open(join(workflowDataDir(), "swarmy.db"));
    return checkpoints;
  };

  port.onMessage((input: unknown) => {
    const message = readMessage(input);
    if (!message) {
      return;
    }

    if (message.type === "engine.ping") {
      port.postMessage({ type: "engine.pong", id: message.id });
      return;
    }

    if (message.type === "engine.hello") {
      port.postMessage({ type: "engine.ready" });
      return;
    }

    if (message.type === "cursor.test") {
      void answerTest(port, getRuntime(), message);
      return;
    }

    if (message.type === "cursor.hello") {
      void answerHello(port, getRuntime(), message);
      return;
    }

    if (message.type === "run.start") {
      if (graphRunning) {
        port.postMessage({
          type: "run.done",
          id: message.id,
          nodeId: message.nodeId,
          status: "failed",
          log: "Another agent is already running.",
        });
        return;
      }
      void answerRun(port, getRuntime(), getWorkspaces, message, activeRuns, starting, pendingCancels);
      return;
    }

    if (message.type === "workflow.run" || message.type === "workflow.resume") {
      void answerWorkflowRun(port, getRuntime(), getWorkspaces, getCheckpointer, message, () => graphRunning || activeRuns.size > 0, (running) => {
        graphRunning = running;
      }, (handle) => {
        workflowHandle = handle;
      });
      return;
    }

    if (message.type === "run.cancel") {
      if (workflowHandle) {
        void answerWorkflowNodeCancel(port, message, workflowHandle);
        return;
      }
      void answerCancel(port, message, activeRuns, starting, pendingCancels);
      return;
    }

    if (message.type === "workflow.cancel") {
      void answerWorkflowCancel(port, message, workflowHandle);
      return;
    }

    if (message.type === "run.steer") {
      void answerSteer(port, message, activeRuns, workflowHandle);
      return;
    }

    if (message.type === "run.unfinished") {
      answerUnfinished(port, message, getCheckpointer);
      return;
    }

    if (message.type === "run.history") {
      answerHistory(port, message, getCheckpointer);
      return;
    }

    if (message.type === "run.historyOpen") {
      answerHistoryOpen(port, message, getCheckpointer);
      return;
    }

    if (message.type === "run.historyRefresh") {
      void answerHistoryRefresh(port, getRuntime(), message, getCheckpointer);
      return;
    }

    if (message.type === "approval.list") {
      void answerApprovalList(port, message, getCheckpointer);
      return;
    }

    if (message.type === "approval.decide") {
      void answerApprovalDecide(port, message, workflowHandle);
      return;
    }

    if (isWorkflowRequest(message)) {
      answerWorkflow(port, getWorkflows, message);
    }
  });
}

async function answerTest(
  port: EnginePort,
  runtimePromise: Promise<AgentRuntime>,
  message: Extract<EngineMessage, { type: "cursor.test" }>,
): Promise<void> {
  try {
    const runtime = await runtimePromise;
    const account = await runtime.account(message.apiKey);
    const models = await runtime.models(message.apiKey);
    port.postMessage({
      type: "cursor.testResult",
      id: message.id,
      accountLabel: account.label,
      modelIds: models.map((model) => model.id),
    });
  } catch (error) {
    postFailure(port, message.id, error, message.apiKey);
  }
}

async function answerHello(
  port: EnginePort,
  runtimePromise: Promise<AgentRuntime>,
  message: Extract<EngineMessage, { type: "cursor.hello" }>,
): Promise<void> {
  try {
    const runtime = await runtimePromise;
    const cwd = await mkdtemp(join(tmpdir(), "swarmy-hello-"));
    const result = await runtime.hello({
      apiKey: message.apiKey,
      cwd,
      prompt: HELLO_PROMPT,
      systemPrompt: HELLO_SYSTEM_PROMPT,
    });
    port.postMessage({
      type: "cursor.helloResult",
      id: message.id,
      text: result.text,
      systemPromptAccepted: result.systemPromptAccepted,
      cwd,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error) {
    postFailure(port, message.id, error, message.apiKey);
  }
}

async function answerRun(
  port: EnginePort,
  runtimePromise: Promise<AgentRuntime>,
  getWorkspaces: () => WorkspaceManager,
  message: Extract<EngineMessage, { type: "run.start" }>,
  activeRuns: Map<string, AgentRunSession>,
  starting: Set<string>,
  pendingCancels: Set<string>,
): Promise<void> {
  if (activeRuns.size > 0) {
    port.postMessage({
      type: "run.done",
      id: message.id,
      nodeId: message.nodeId,
      status: "failed",
      log: scrub("Another agent is already running.", message.apiKey),
    });
    return;
  }

  starting.add(message.nodeId);
  let workspace: AgentWorkspace | undefined;
  try {
    const runtime = await runtimePromise;
    const mode = message.workspaceMode ?? "managed";
    workspace = await getWorkspaces().provision({
      id: runWorkspaceId(message.nodeId),
      mode,
      ...(message.repositoryPath ? { repositoryPath: message.repositoryPath } : {}),
      ...(message.folderPath ? { folderPath: message.folderPath } : {}),
    });
    const workspacePath = workspace.path;
    let agentId = "";
    const session = startAgentRun({
      runtime,
      request: {
        apiKey: message.apiKey,
        cwd: workspacePath,
        prompt: message.prompt,
        ...(message.modelId ? { modelId: message.modelId } : {}),
        ...(message.systemPrompt !== undefined ? { systemPrompt: message.systemPrompt } : {}),
        ...(message.tools !== undefined ? { tools: message.tools } : {}),
        ...(message.disallowedTools !== undefined ? { disallowedTools: message.disallowedTools } : {}),
        ...(message.guardrails !== undefined ? { guardrails: message.guardrails } : {}),
        ...(message.writePaths !== undefined ? { writePaths: message.writePaths } : {}),
        ...(message.sandboxEnabled !== undefined ? { sandboxEnabled: message.sandboxEnabled } : {}),
        ...(message.autoReview !== undefined ? { autoReview: message.autoReview } : {}),
      },
      onAgent(id) {
        agentId = id;
      },
      onUpdate(update) {
        port.postMessage({
          type: "run.update",
          nodeId: message.nodeId,
          status: update.status,
          log: scrub(update.log, message.apiKey),
          workspacePath,
        });
      },
    });
    activeRuns.set(message.nodeId, session);
    starting.delete(message.nodeId);
    if (pendingCancels.delete(message.nodeId)) {
      await session.cancel();
    }
    const outcome = await session.done;
    const log = noteSingleRunBudget(message.budgetTokens, outcome.log, outcome.totalTokens);
    persistSingleRun(message, log, outcome, agentId);
    await getWorkspaces().teardown(workspace);
    workspace = undefined;
    port.postMessage({
      type: "run.done",
      id: message.id,
      nodeId: message.nodeId,
      status: outcome.status,
      log: scrub(log, message.apiKey),
      workspacePath,
    });
  } catch (error) {
    if (workspace) {
      await getWorkspaces().teardown(workspace).catch(() => undefined);
    }
    const text = scrub(error instanceof Error && error.message ? error.message : "The run failed", message.apiKey);
    port.postMessage({
      type: "run.done",
      id: message.id,
      nodeId: message.nodeId,
      status: "failed",
      log: text.length > 0 ? text : "The run failed",
    });
  } finally {
    starting.delete(message.nodeId);
    activeRuns.delete(message.nodeId);
    pendingCancels.delete(message.nodeId);
  }
}

async function answerWorkflowRun(
  port: EnginePort,
  runtimePromise: Promise<AgentRuntime>,
  getWorkspaces: () => WorkspaceManager,
  getCheckpointer: () => SqliteCheckpointer,
  message: Extract<EngineMessage, { type: "workflow.run" | "workflow.resume" }>,
  isBusy: () => boolean,
  setRunning: (running: boolean) => void,
  setHandle: (handle: WorkflowRunHandle | undefined) => void,
): Promise<void> {
  if (isBusy()) {
    port.postMessage({
      type: "workflow.failed",
      id: message.id,
      message: "Another agent is already running.",
    });
    return;
  }

  setRunning(true);
  try {
    const runtime = await runtimePromise;
    const handle = startWorkflowRun({
      workflow: message.workflow,
      runtime,
      apiKey: message.apiKey,
      workspaces: getWorkspaces(),
      checkpointer: getCheckpointer(),
      ...(message.type === "workflow.resume"
        ? {
            resume: true,
            threadId: message.threadId,
            ...(message.decision ? { decision: message.decision } : {}),
          }
        : {}),
      onUpdate(update) {
        port.postMessage({
          type: "run.update",
          nodeId: update.nodeId,
          status: update.status,
          log: scrub(update.log, message.apiKey),
          ...(update.workspacePath ? { workspacePath: update.workspacePath } : {}),
          ...(update.files && update.files.length > 0 ? { files: update.files } : {}),
        });
      },
    });
    setHandle(handle);
    const result = await handle.done;
    port.postMessage({
      type: "workflow.runDone",
      id: message.id,
      statuses: result.statuses,
      runStatus: result.runStatus,
      ...(result.budgetNote ? { budgetNote: result.budgetNote } : {}),
    });
  } catch (error) {
    const text = scrub(error instanceof Error && error.message ? error.message : "The workflow run failed", message.apiKey);
    port.postMessage({
      type: "workflow.failed",
      id: message.id,
      message: text.length > 0 ? text : "The workflow run failed",
    });
  } finally {
    setHandle(undefined);
    setRunning(false);
  }
}

async function answerWorkflowNodeCancel(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "run.cancel" }>,
  handle: WorkflowRunHandle,
): Promise<void> {
  try {
    await handle.cancelNode(message.nodeId);
    port.postMessage({ type: "run.cancelResult", id: message.id });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Cancel failed";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

async function answerWorkflowCancel(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "workflow.cancel" }>,
  handle: WorkflowRunHandle | undefined,
): Promise<void> {
  try {
    await handle?.cancel();
    port.postMessage({ type: "workflow.cancelResult", id: message.id });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Cancel failed";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

async function answerSteer(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "run.steer" }>,
  activeRuns: Map<string, AgentRunSession>,
  handle: WorkflowRunHandle | undefined,
): Promise<void> {
  try {
    const session = activeRuns.get(message.nodeId);
    const delivery = session
      ? await session.steer(message.text)
      : await handle?.steer(message.nodeId, message.text);
    if (!delivery) {
      throw new Error("That agent is not running");
    }
    port.postMessage({ type: "run.steerResult", id: message.id, delivery });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Steer failed";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

function answerUnfinished(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "run.unfinished" }>,
  getCheckpointer: () => SqliteCheckpointer,
): void {
  try {
    const threadId = unfinishedThread(getCheckpointer().databasePath, message.workflowId);
    port.postMessage({
      type: "run.unfinishedResult",
      id: message.id,
      ...(threadId ? { threadId } : {}),
    });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Could not look up the run";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

function answerHistory(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "run.history" }>,
  getCheckpointer: () => SqliteCheckpointer,
): void {
  const catalog = openCatalog(getCheckpointer);
  if (!catalog) {
    port.postMessage({ type: "run.historyResult", id: message.id, runs: [] });
    return;
  }
  try {
    port.postMessage({ type: "run.historyResult", id: message.id, runs: catalog.listRuns(message.workflowId) });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Could not list runs";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  } finally {
    catalog.close();
  }
}

function answerHistoryOpen(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "run.historyOpen" }>,
  getCheckpointer: () => SqliteCheckpointer,
): void {
  const catalog = openCatalog(getCheckpointer);
  if (!catalog) {
    port.postMessage({ type: "run.failed", id: message.id, message: "Could not open the run" });
    return;
  }
  try {
    port.postMessage({
      type: "run.historyOpenResult",
      id: message.id,
      detail: catalog.runDetail(message.threadId),
    });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Could not open the run";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  } finally {
    catalog.close();
  }
}

async function answerHistoryRefresh(
  port: EnginePort,
  runtimePromise: Promise<AgentRuntime>,
  message: Extract<EngineMessage, { type: "run.historyRefresh" }>,
  getCheckpointer: () => SqliteCheckpointer,
): Promise<void> {
  const catalog = openCatalog(getCheckpointer);
  if (!catalog) {
    port.postMessage({ type: "run.failed", id: message.id, message: "Could not refresh the cost" });
    return;
  }
  try {
    const runtime = await runtimePromise;
    for (const agent of catalog.agents(message.threadId)) {
      try {
        const cost = await runtime.usageForAgent(message.apiKey, agent.agentId);
        if (cost.chargedCents !== undefined) {
          catalog.setChargedCents(message.threadId, agent.nodeId, cost.chargedCents);
        }
      } catch {
        // A missing or failed report stays pending. Do not store zero.
      }
    }
    port.postMessage({
      type: "run.historyRefreshResult",
      id: message.id,
      detail: catalog.runDetail(message.threadId),
    });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Could not refresh the cost";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  } finally {
    catalog.close();
  }
}

function openCatalog(getCheckpointer: () => SqliteCheckpointer): RunCatalog | undefined {
  try {
    return openRunCatalog(getCheckpointer().databasePath);
  } catch {
    return undefined;
  }
}

function noteSingleRunBudget(
  budgetTokens: number | undefined,
  log: string,
  totalTokens: number | undefined,
): string {
  if (budgetTokens === undefined || totalTokens === undefined) {
    return log;
  }
  if (totalTokens <= budgetTokens || log.includes(budgetExceededMessage)) {
    return log;
  }
  return log.length > 0 ? `${log}\n${budgetExceededMessage}` : budgetExceededMessage;
}

function persistSingleRun(
  message: Extract<EngineMessage, { type: "run.start" }>,
  log: string,
  outcome: { status: "completed" | "failed" | "cancelled"; totalTokens?: number; chargedCents?: number },
  agentId: string,
): void {
  if (!message.workflowId || (process.env.VITEST === "true" && !process.env.SWARMY_DATA_DIR?.trim())) {
    return;
  }
  let catalog: RunCatalog | undefined;
  try {
    catalog = openRunCatalog(join(workflowDataDir(), "swarmy.db"));
    const threadId = randomUUID();
    catalog.markRunning(threadId, message.workflowId);
    if (agentId.length > 0) {
      catalog.rememberAgent(threadId, message.nodeId, agentId);
    }
    catalog.recordNode({
      threadId,
      nodeId: message.nodeId,
      transcript: log,
      totalTokens: outcome.totalTokens,
      chargedCents: outcome.chargedCents,
    });
    const overBudget =
      message.budgetTokens !== undefined &&
      outcome.totalTokens !== undefined &&
      outcome.totalTokens > message.budgetTokens;
    catalog.markFinished(
      threadId,
      overBudget ? "budget_exceeded" : outcome.status === "completed" ? "completed" : outcome.status,
    );
  } catch {
    // History is best-effort for a card run. The live log is already on its way.
  } finally {
    catalog?.close();
  }
}

async function answerApprovalList(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "approval.list" }>,
  getCheckpointer: () => SqliteCheckpointer,
): Promise<void> {
  try {
    const approvals = await listPendingApprovals({
      workflow: message.workflow,
      checkpointer: getCheckpointer(),
      threadId: message.threadId,
    });
    port.postMessage({ type: "approval.listResult", id: message.id, approvals });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Could not list approvals";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

async function answerApprovalDecide(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "approval.decide" }>,
  handle: WorkflowRunHandle | undefined,
): Promise<void> {
  try {
    if (!handle) {
      throw new Error("No approval is waiting");
    }
    await handle.decide(message.decision);
    port.postMessage({ type: "approval.decideResult", id: message.id });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Could not record the decision";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

function runWorkspaceId(nodeId: string): string {
  const safe = nodeId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
  return `${safe}-${randomUUID()}`;
}

async function answerCancel(
  port: EnginePort,
  message: Extract<EngineMessage, { type: "run.cancel" }>,
  activeRuns: Map<string, AgentRunSession>,
  starting: Set<string>,
  pendingCancels: Set<string>,
): Promise<void> {
  const session = activeRuns.get(message.nodeId);
  try {
    if (session) {
      await session.cancel();
    } else if (starting.has(message.nodeId)) {
      pendingCancels.add(message.nodeId);
    }
    port.postMessage({ type: "run.cancelResult", id: message.id });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "Cancel failed";
    port.postMessage({ type: "run.failed", id: message.id, message: text });
  }
}

function postFailure(port: EnginePort, id: string, error: unknown, secret: string): void {
  const message = scrub(error instanceof Error ? error.message : "The request failed", secret);
  port.postMessage({
    type: "cursor.failed",
    id,
    message: message.length > 0 ? message : "The request failed",
  });
}

function scrub(message: string, secret: string): string {
  if (!secret) {
    return message;
  }
  return message.split(secret).join("[redacted]");
}

function readMessage(input: unknown): EngineMessage | undefined {
  try {
    return parseEngineMessage(input);
  } catch {
    return undefined;
  }
}

type WorkflowRequest = Extract<
  EngineMessage,
  { type: "workflow.save" | "workflow.load" | "workflow.list" | "workflow.delete" }
>;

function isWorkflowRequest(message: EngineMessage): message is WorkflowRequest {
  return (
    message.type === "workflow.save" ||
    message.type === "workflow.load" ||
    message.type === "workflow.list" ||
    message.type === "workflow.delete"
  );
}

function answerWorkflow(port: EnginePort, getWorkflows: () => WorkflowDb, message: WorkflowRequest): void {
  try {
    const db = getWorkflows();
    if (message.type === "workflow.save") {
      port.postMessage({ type: "workflow.saveResult", id: message.id, summary: db.save(message.workflow) });
      return;
    }
    if (message.type === "workflow.load") {
      port.postMessage({ type: "workflow.loadResult", id: message.id, workflow: db.load(message.workflowId) });
      return;
    }
    if (message.type === "workflow.list") {
      port.postMessage({ type: "workflow.listResult", id: message.id, workflows: db.list() });
      return;
    }
    db.delete(message.workflowId);
    port.postMessage({ type: "workflow.deleteResult", id: message.id });
  } catch (error) {
    const text = error instanceof Error && error.message ? error.message : "The workflow request failed";
    port.postMessage({ type: "workflow.failed", id: message.id, message: text });
  }
}
