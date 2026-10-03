import type { AgentRuntime, CreateAgentRequest, RuntimeEvent, RuntimeRun, RuntimeRunResult } from "./runtime";

export type AgentNodeStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentRunRequest extends CreateAgentRequest {
  prompt: string;
}

export interface AgentRunOutcome {
  status: Exclude<AgentNodeStatus, "running">;
  log: string;
  error?: string;
}

export interface AgentRunUpdate {
  status: AgentNodeStatus;
  log: string;
}

export interface AgentRunSession {
  done: Promise<AgentRunOutcome>;
  cancel(): Promise<void>;
  until(match: (event: RuntimeEvent) => boolean): Promise<void>;
}

export function startAgentRun(input: {
  runtime: AgentRuntime;
  request: AgentRunRequest;
  onUpdate?: (update: AgentRunUpdate) => void;
}): AgentRunSession {
  const seen: RuntimeEvent[] = [];
  const waiters = new Set<(event: RuntimeEvent) => void>();
  let run: RuntimeRun | undefined;
  let cancelRequested = false;
  let canceling: Promise<void> | undefined;

  const publish = (event: RuntimeEvent): void => {
    seen.push(event);
    for (const waiter of waiters) {
      waiter(event);
    }
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
    let log = "";
    const report = (status: AgentNodeStatus, nextLog: string): void => {
      input.onUpdate?.({ status, log: nextLog });
    };

    try {
      report("running", log);
      agent = await input.runtime.create(createRequest(input.request));
      if (cancelRequested) {
        const outcome: AgentRunOutcome = { status: "cancelled", log };
        report("cancelled", log);
        return outcome;
      }

      const prompt = input.request.prompt.trim().length > 0 ? input.request.prompt : "Reply.";
      run = await agent.send(prompt);
      if (cancelRequested) {
        await run.cancel();
      }

      for await (const event of run.stream()) {
        log = appendEvent(log, event);
        publish(event);
        report("running", log);
      }

      const result = await run.wait();
      return finish(result, log, report);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Run did not start";
      const failedLog = log.length > 0 ? `${log}\nRun did not start: ${message}` : `Run did not start: ${message}`;
      report("failed", failedLog);
      return { status: "failed", log: failedLog, error: message };
    } finally {
      await agent?.dispose();
    }
  }
}

function finish(
  result: RuntimeRunResult,
  log: string,
  report: (status: AgentNodeStatus, nextLog: string) => void,
): AgentRunOutcome {
  if (result.status === "error") {
    const message = result.error ?? "Run failed";
    const failedLog = appendLine(log, message);
    report("failed", failedLog);
    return { status: "failed", log: failedLog, error: message };
  }
  if (result.status === "cancelled") {
    report("cancelled", log);
    return { status: "cancelled", log };
  }
  const completedLog =
    result.text.length > 0 && !log.includes(result.text) ? appendLine(log, result.text) : log;
  report("completed", completedLog);
  return { status: "completed", log: completedLog };
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
  };
}

function appendEvent(log: string, event: RuntimeEvent): string {
  if (event.type === "assistant") {
    return log + event.text;
  }
  const line = event.type === "tool" ? `${event.name} (${event.status})` : event.text;
  return appendLine(log, line);
}

function appendLine(log: string, line: string): string {
  if (log.length === 0) return line;
  return log.endsWith("\n") ? `${log}${line}` : `${log}\n${line}`;
}
