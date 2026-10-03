import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEngineMessage, type EngineMessage } from "@shared/protocol";
import { startAgentRun, type AgentRunSession } from "./agent-run";
import { createRuntime } from "./create-runtime";
import { HELLO_PROMPT, HELLO_SYSTEM_PROMPT, type AgentRuntime } from "./runtime";
import { openWorkflowDb, workflowDataDir, type WorkflowDb } from "./workflow-db";

export interface EnginePort {
  postMessage(message: EngineMessage): void;
  onMessage(listener: (message: unknown) => void): void;
}

export function attachEngine(port: EnginePort, runtime?: AgentRuntime): void {
  let runtimePromise: Promise<AgentRuntime> | undefined;
  let workflows: WorkflowDb | undefined;
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
      void answerRun(port, getRuntime(), message, activeRuns, starting, pendingCancels);
      return;
    }

    if (message.type === "run.cancel") {
      void answerCancel(port, message, activeRuns, starting, pendingCancels);
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
  try {
    const runtime = await runtimePromise;
    const cwd = await mkdtemp(join(tmpdir(), "swarmy-run-"));
    const session = startAgentRun({
      runtime,
      request: {
        apiKey: message.apiKey,
        cwd,
        prompt: message.prompt,
        ...(message.modelId ? { modelId: message.modelId } : {}),
        ...(message.systemPrompt !== undefined ? { systemPrompt: message.systemPrompt } : {}),
        ...(message.tools !== undefined ? { tools: message.tools } : {}),
        ...(message.disallowedTools !== undefined ? { disallowedTools: message.disallowedTools } : {}),
      },
      onUpdate(update) {
        port.postMessage({
          type: "run.update",
          nodeId: message.nodeId,
          status: update.status,
          log: scrub(update.log, message.apiKey),
        });
      },
    });
    activeRuns.set(message.nodeId, session);
    starting.delete(message.nodeId);
    if (pendingCancels.delete(message.nodeId)) {
      await session.cancel();
    }
    const outcome = await session.done;
    port.postMessage({
      type: "run.done",
      id: message.id,
      nodeId: message.nodeId,
      status: outcome.status,
      log: scrub(outcome.log, message.apiKey),
    });
  } catch (error) {
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
