import { guardrailPromptNote } from "./guardrails";
import type {
  AgentRuntime,
  CreateAgentRequest,
  RuntimeEvent,
  RuntimeRun,
  RuntimeRunResult,
  RuntimeTokenUsage,
  SteerAck,
} from "./runtime";

export type AgentNodeStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentRunRequest extends CreateAgentRequest {
  prompt: string;
  agentId?: string;
  /** When a budget is set, poll getUsage briefly so a late cost can still stop the run. */
  waitForCost?: boolean;
}

export interface AgentRunOutcome {
  status: Exclude<AgentNodeStatus, "running">;
  log: string;
  text: string;
  error?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  chargedCents?: number;
}

export interface AgentRunUpdate {
  status: AgentNodeStatus;
  log: string;
}

export interface AgentRunSession {
  done: Promise<AgentRunOutcome>;
  cancel(): Promise<void>;
  steer(text: string): Promise<SteerAck>;
  until(match: (event: RuntimeEvent) => boolean): Promise<void>;
}

export function startAgentRun(input: {
  runtime: AgentRuntime;
  request: AgentRunRequest;
  onUpdate?: (update: AgentRunUpdate) => void;
  onAgent?: (agentId: string) => void;
}): AgentRunSession {
  const seen: RuntimeEvent[] = [];
  const waiters = new Set<(event: RuntimeEvent) => void>();
  let run: RuntimeRun | undefined;
  let log = "";
  let cancelRequested = false;
  let canceling: Promise<void> | undefined;
  let pendingFollowup: string | undefined;
  let resolveRun: ((ready: RuntimeRun) => void) | undefined;
  let rejectRun: ((error: Error) => void) | undefined;
  const runReady = new Promise<RuntimeRun>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  runReady.catch(() => undefined);

  const publish = (event: RuntimeEvent): void => {
    seen.push(event);
    for (const waiter of waiters) {
      waiter(event);
    }
  };

  const report = (status: AgentNodeStatus, nextLog: string): void => {
    input.onUpdate?.({ status, log: nextLog });
  };

  const done = execute();

  return {
    done,
    cancel() {
      cancelRequested = true;
      if (!run) {
        return Promise.resolve();
      }
      canceling ??= run.cancel();
      return canceling;
    },
    async steer(text) {
      const ready = await runReady;
      const ack = await ready.steer(text);
      if (ack === "revert_to_followup") {
        pendingFollowup = text;
        return ack;
      }
      pendingFollowup = undefined;
      note("Steering delivered");
      return ack;
    },
    until(match) {
      if (seen.some(match)) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const waiter = (event: RuntimeEvent): void => {
          if (!match(event)) return;
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
      });
    },
  };

  async function execute(): Promise<AgentRunOutcome> {
    let agent: Awaited<ReturnType<AgentRuntime["create"]>> | undefined;

    try {
      report("running", log);
      const launch = createRequest(input.request);
      agent = input.request.agentId
        ? await input.runtime.resume({ ...launch, agentId: input.request.agentId })
        : await input.runtime.create(launch);
      input.onAgent?.(agent.agentId);
      if (input.request.guardrails) {
        note("Guardrails hook installed.");
      }
      if (cancelRequested) {
        settleRun(new Error("Run was cancelled"));
        const outcome: AgentRunOutcome = { status: "cancelled", log, text: "" };
        report("cancelled", log);
        return outcome;
      }

      const prompt = agentPrompt(input.request);
      run = await agent.send(prompt);
      resolveRun?.(run);
      if (cancelRequested) {
        await run.cancel();
      }

      for await (const event of run.stream()) {
        log = appendEvent(log, event);
        publish(event);
        report("running", log);
      }

      const result = await run.wait();
      if (result.status === "finished" && pendingFollowup) {
        const followup = pendingFollowup;
        pendingFollowup = undefined;
        note("Steering sent as a follow-up");
        const follow = await agent.send(followup);
        for await (const event of follow.stream()) {
          log = appendEvent(log, event);
          publish(event);
          report("running", log);
        }
        const followed = await follow.wait();
        const chargedCents = await reportedCost(agent, input.request.waitForCost === true, () => {
          note("Waiting for the dollar cost before the next agent.");
        });
        return finish(followed, log, report, {
          ...combinedUsage(result.usage, followed.usage),
          chargedCents,
        });
      }
      const chargedCents = await reportedCost(agent, input.request.waitForCost === true, () => {
        note("Waiting for the dollar cost before the next agent.");
      });
      return finish(result, log, report, {
        ...usageParts(result.usage),
        chargedCents,
      });
    } catch (error) {
      settleRun(error instanceof Error ? error : new Error("Run did not start"));
      const message = error instanceof Error && error.message ? error.message : "Run did not start";
      const failedLog = log.length > 0 ? `${log}\nRun did not start: ${message}` : `Run did not start: ${message}`;
      report("failed", failedLog);
      return { status: "failed", log: failedLog, text: "", error: message };
    } finally {
      await agent?.dispose();
    }
  }

  function settleRun(error: Error): void {
    if (!run) {
      rejectRun?.(error);
    }
  }

  function note(message: string): void {
    log = appendLine(log, message);
    if (!log.endsWith("\n")) {
      log = `${log}\n`;
    }
    report("running", log);
  }
}

function costWaitMs(): number {
  return process.env.VITEST === "true" ? 0 : 2000;
}

function costWaitAttempts(): number {
  return process.env.VITEST === "true" ? 1 : 8;
}

async function reportedCost(
  agent: Awaited<ReturnType<AgentRuntime["create"]>>,
  waitForCost: boolean,
  onWaiting?: () => void,
): Promise<number | undefined> {
  const first = await askCost(agent);
  if (first !== undefined || !waitForCost) {
    return first;
  }
  onWaiting?.();
  for (let attempt = 0; attempt < costWaitAttempts(); attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, costWaitMs());
    });
    const next = await askCost(agent);
    if (next !== undefined) {
      return next;
    }
  }
  return undefined;
}

async function askCost(agent: Awaited<ReturnType<AgentRuntime["create"]>>): Promise<number | undefined> {
  try {
    const usage = await agent.getUsage();
    return usage.chargedCents;
  } catch {
    return undefined;
  }
}

function addTokens(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

interface RunAccounting {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  chargedCents?: number;
}

function finish(
  result: RuntimeRunResult,
  log: string,
  report: (status: AgentNodeStatus, nextLog: string) => void,
  accounting: RunAccounting,
): AgentRunOutcome {
  if (result.status === "error") {
    const message = result.error ?? "Run failed";
    const failedLog = appendLine(log, message);
    report("failed", failedLog);
    return account({ status: "failed", log: failedLog, text: result.text, error: message }, accounting);
  }
  if (result.status === "cancelled") {
    report("cancelled", log);
    return account({ status: "cancelled", log, text: result.text }, accounting);
  }
  const completedLog =
    result.text.length > 0 && !log.includes(result.text) ? appendLine(log, result.text) : log;
  report("completed", completedLog);
  return account({ status: "completed", log: completedLog, text: result.text }, accounting);
}

function account(outcome: AgentRunOutcome, accounting: RunAccounting): AgentRunOutcome {
  return {
    ...outcome,
    ...(accounting.totalTokens !== undefined ? { totalTokens: accounting.totalTokens } : {}),
    ...(accounting.inputTokens !== undefined ? { inputTokens: accounting.inputTokens } : {}),
    ...(accounting.outputTokens !== undefined ? { outputTokens: accounting.outputTokens } : {}),
    ...(accounting.cacheReadTokens !== undefined ? { cacheReadTokens: accounting.cacheReadTokens } : {}),
    ...(accounting.cacheWriteTokens !== undefined ? { cacheWriteTokens: accounting.cacheWriteTokens } : {}),
    ...(accounting.chargedCents !== undefined ? { chargedCents: accounting.chargedCents } : {}),
  };
}

function usageParts(usage: RuntimeTokenUsage | undefined): RunAccounting {
  if (!usage) {
    return {};
  }
  return {
    totalTokens: usage.totalTokens,
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
  };
}

function combinedUsage(left: RuntimeTokenUsage | undefined, right: RuntimeTokenUsage | undefined): RunAccounting {
  const totalTokens = addTokens(left?.totalTokens, right?.totalTokens);
  return {
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...summedPart(left?.inputTokens, right?.inputTokens, "inputTokens"),
    ...summedPart(left?.outputTokens, right?.outputTokens, "outputTokens"),
    ...summedPart(left?.cacheReadTokens, right?.cacheReadTokens, "cacheReadTokens"),
    ...summedPart(left?.cacheWriteTokens, right?.cacheWriteTokens, "cacheWriteTokens"),
  };
}

function summedPart(
  left: number | undefined,
  right: number | undefined,
  key: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens",
): RunAccounting {
  if (left === undefined || right === undefined) {
    return {};
  }
  return { [key]: left + right };
}

function createRequest(request: AgentRunRequest): CreateAgentRequest {
  const systemPrompt = request.systemPrompt?.trim();
  const modelId = request.modelId?.trim();
  return {
    apiKey: request.apiKey,
    cwd: request.cwd,
    ...(modelId ? { modelId } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(request.tools !== undefined ? { tools: request.tools } : {}),
    ...(request.disallowedTools !== undefined ? { disallowedTools: request.disallowedTools } : {}),
    ...(request.customTools !== undefined ? { customTools: request.customTools } : {}),
    ...(request.mcpServers !== undefined ? { mcpServers: request.mcpServers } : {}),
    ...(request.guardrails !== undefined ? { guardrails: request.guardrails } : {}),
    ...(request.writePaths !== undefined ? { writePaths: request.writePaths } : {}),
    ...(request.sandboxEnabled !== undefined ? { sandboxEnabled: request.sandboxEnabled } : {}),
    ...(request.autoReview !== undefined ? { autoReview: request.autoReview } : {}),
  };
}

function agentPrompt(request: AgentRunRequest): string {
  const task = request.prompt.trim().length > 0 ? request.prompt : "Reply.";
  if (!request.guardrails) return task;
  return `${task}\n\n${guardrailPromptNote(request.writePaths ?? [])}`;
}

function appendEvent(log: string, event: RuntimeEvent): string {
  if (event.type === "assistant") {
    return log + event.text;
  }
  const line =
    event.type === "tool"
      ? event.detail
        ? `${event.name} (${event.status}): ${event.detail}`
        : `${event.name} (${event.status})`
      : event.text;
  return appendLine(log, line);
}

function appendLine(log: string, line: string): string {
  if (log.length === 0) return line;
  return log.endsWith("\n") ? `${log}${line}` : `${log}\n${line}`;
}
