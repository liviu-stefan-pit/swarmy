import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { createTriggerHost } from "./triggers";

function watchedWorkflow(id: string, directory: string): Workflow {
  return {
    id,
    name: id,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    trigger: { mode: "watch", directory },
  };
}

it("starts a run when a file is added to the watched directory and ignores another directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarmy-watch-"));
  const watched = join(root, "watched");
  const other = join(root, "other");
  await mkdir(watched);
  await mkdir(other);
  const started: string[] = [];
  const host = createTriggerHost({
    startRun(workflow) {
      started.push(workflow.id);
      return Promise.resolve();
    },
  });

  try {
    host.sync([watchedWorkflow("wf", watched)]);
    await writeFile(join(other, "nope.txt"), "no");
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    expect(started).toEqual([]);

    await writeFile(join(watched, "yes.txt"), "yes");
    await vi.waitFor(() => {
      expect(started).toEqual(["wf"]);
    });
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("records a skip and does not start another run while one is active", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarmy-watch-skip-"));
  const watched = join(root, "watched");
  await mkdir(watched);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  const host = createTriggerHost({
    startRun(workflow) {
      started.push(workflow.id);
      return gate;
    },
  });

  try {
    host.sync([watchedWorkflow("wf", watched)]);
    await writeFile(join(watched, "first.txt"), "1");
    await vi.waitFor(() => {
      expect(started).toEqual(["wf"]);
    });

    await writeFile(join(watched, "second.txt"), "2");
    await vi.waitFor(() => {
      expect(host.skips()).toEqual([
        expect.objectContaining({
          workflowId: "wf",
          reason: "skipped",
          path: join(watched, "second.txt"),
        }),
      ]);
    });
    expect(started).toEqual(["wf"]);
  } finally {
    release();
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});
