import { readdirSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { TriggerRunEvent, TriggerSkip } from "@shared/triggers";
import type { Workflow } from "@shared/workflow";

const watchPollMs = 250;

export type TriggerHost = {
  sync(workflows: readonly Workflow[]): void;
  skips(): readonly TriggerSkip[];
  hold(workflowId: string): boolean;
  release(workflowId: string): void;
  close(): void;
};

type WatchEntry = {
  kind: "watch";
  workflow: Workflow;
  directory: string;
  watcher: FSWatcher;
  poll: ReturnType<typeof setInterval>;
  seen: Set<string>;
  closed: boolean;
};

type IntervalEntry = {
  kind: "interval";
  workflow: Workflow;
  minutes: number;
  timer: ReturnType<typeof setInterval>;
  closed: boolean;
};

type Armed = WatchEntry | IntervalEntry;

export function createTriggerHost(options: {
  startRun: (workflow: Workflow) => Promise<void>;
  now?: () => number;
  onSkip?: (skip: TriggerSkip) => void;
  onRun?: (event: TriggerRunEvent) => void;
}): TriggerHost {
  const now = options.now ?? Date.now;
  const skips: TriggerSkip[] = [];
  const claimed = new Set<string>();
  const armed = new Map<string, Armed>();

  function recordSkip(workflowId: string, path: string): void {
    const skip: TriggerSkip = { workflowId, path, reason: "skipped", at: now() };
    skips.push(skip);
    options.onSkip?.(skip);
  }

  function fire(workflow: Workflow, path: string): void {
    if (claimed.size > 0) {
      recordSkip(workflow.id, path);
      return;
    }
    claimed.add(workflow.id);
    options.onRun?.({ workflowId: workflow.id, state: "started" });
    let failure = "";
    void Promise.resolve()
      .then(() => options.startRun(workflow))
      .then(
        () => undefined,
        (error: unknown) => {
          failure = error instanceof Error && error.message ? error.message : "The run failed";
        },
      )
      .finally(() => {
        claimed.delete(workflow.id);
        options.onRun?.({
          workflowId: workflow.id,
          state: "finished",
          ...(failure.length > 0 ? { message: failure } : {}),
        });
      });
  }

  function disarm(id: string): void {
    const entry = armed.get(id);
    if (!entry) {
      return;
    }
    entry.closed = true;
    if (entry.kind === "watch") {
      entry.watcher.close();
      clearInterval(entry.poll);
    } else {
      clearInterval(entry.timer);
    }
    armed.delete(id);
  }

  function scan(entry: WatchEntry): void {
    if (entry.closed) {
      return;
    }
    let names: { name: string; isFile: () => boolean }[];
    try {
      names = readdirSync(entry.directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of names) {
      if (!item.isFile() || entry.seen.has(item.name)) {
        continue;
      }
      entry.seen.add(item.name);
      const current = armed.get(entry.workflow.id);
      const workflow = current?.kind === "watch" ? current.workflow : entry.workflow;
      fire(workflow, join(entry.directory, item.name));
    }
  }

  function armWatch(workflow: Workflow, directory: string): void {
    const current = armed.get(workflow.id);
    if (current?.kind === "watch" && current.directory === directory) {
      current.workflow = workflow;
      return;
    }
    disarm(workflow.id);
    const seen = new Set<string>();
    try {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        if (item.isFile()) {
          seen.add(item.name);
        }
      }
    } catch {
      return;
    }
    const box: { current?: WatchEntry } = {};
    const watcher: FSWatcher = watch(directory, () => {
      if (box.current) {
        scan(box.current);
      }
    });
    const poll = setInterval(() => {
      if (box.current) {
        scan(box.current);
      }
    }, watchPollMs);
    const entry: WatchEntry = {
      kind: "watch",
      workflow,
      directory,
      seen,
      closed: false,
      watcher,
      poll,
    };
    box.current = entry;
    watcher.on("error", () => undefined);
    armed.set(workflow.id, entry);
  }

  function armInterval(workflow: Workflow, minutes: number): void {
    if (minutes < 1) {
      disarm(workflow.id);
      return;
    }
    const current = armed.get(workflow.id);
    if (current?.kind === "interval" && current.minutes === minutes) {
      current.workflow = workflow;
      return;
    }
    disarm(workflow.id);
    const entry: IntervalEntry = {
      kind: "interval",
      workflow,
      minutes,
      closed: false,
      timer: setInterval(() => {
        const latest = armed.get(workflow.id);
        if (!latest || latest.kind !== "interval" || latest.closed) {
          return;
        }
        fire(latest.workflow, "");
      }, minutes * 60_000),
    };
    armed.set(workflow.id, entry);
  }

  function arm(workflow: Workflow): void {
    const trigger = workflow.trigger;
    if (!trigger || trigger.mode === "manual") {
      disarm(workflow.id);
      return;
    }
    if (trigger.mode === "interval") {
      armInterval(workflow, trigger.minutes);
      return;
    }
    armWatch(workflow, trigger.directory);
  }

  return {
    sync(workflows) {
      const ids = new Set(workflows.map((workflow) => workflow.id));
      for (const id of [...armed.keys()]) {
        if (!ids.has(id)) {
          disarm(id);
        }
      }
      for (const workflow of workflows) {
        arm(workflow);
      }
    },
    skips() {
      return skips.map((skip) => ({ ...skip }));
    },
    hold(workflowId) {
      if (claimed.size > 0) {
        return false;
      }
      claimed.add(workflowId);
      return true;
    },
    release(workflowId) {
      claimed.delete(workflowId);
    },
    close() {
      for (const id of [...armed.keys()]) {
        disarm(id);
      }
    },
  };
}
