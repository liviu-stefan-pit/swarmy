import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { Workflow } from "@shared/workflow";
import { openWorkflowDb } from "./workflow-db";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "swarmy-workflows-"));
  dirs.push(dir);
  return dir;
}

function sampleWorkflow(id: string, name: string): Workflow {
  return {
    id,
    name,
    viewport: { x: 8, y: 16, zoom: 1 },
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        position: { x: 16, y: 32 },
        data: { label: "Writer" },
      },
      {
        id: "agent-2",
        type: "agent",
        position: { x: 240, y: 32 },
        data: { label: "Reviewer" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "agent-1",
        sourceHandle: "diff",
        target: "agent-2",
        targetHandle: "diff",
      },
    ],
  };
}

it("save then load returns the same graph, including handle ids", async () => {
  const db = openWorkflowDb(await tempDir());
  try {
    const workflow = sampleWorkflow("wf-1", "Line");
    db.save(workflow);

    const loaded = db.load("wf-1");
    expect(loaded).toEqual(workflow);
    expect(loaded.edges.map((edge) => [edge.sourceHandle, edge.targetHandle])).toEqual([["diff", "diff"]]);
  } finally {
    db.close();
  }
});

it("a second save updates updated_at and does not duplicate the row", async () => {
  let clock = 1_700_000_000_000;
  const db = openWorkflowDb(await tempDir(), { now: () => clock });
  try {
    const workflow = sampleWorkflow("wf-1", "Line");
    const first = db.save(workflow);
    clock += 5;
    const second = db.save({ ...workflow, name: "Line renamed" });

    expect(db.list()).toHaveLength(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(first.createdAt + 5);
    expect(db.load("wf-1").name).toBe("Line renamed");
  } finally {
    db.close();
  }
});

it("delete removes the row and leaves other workflows", async () => {
  const db = openWorkflowDb(await tempDir());
  try {
    const kept = sampleWorkflow("wf-2", "Two");
    db.save(sampleWorkflow("wf-1", "One"));
    db.save(kept);
    db.delete("wf-1");

    expect(db.list().map((row) => row.id)).toEqual(["wf-2"]);
    expect(db.load("wf-2")).toEqual(kept);
  } finally {
    db.close();
  }
});
