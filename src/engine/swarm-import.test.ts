import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { packageSwarmArchive } from "@shared/swarm-archive";
import { importSwarmArchive } from "./swarm-import";
import { openWorkflowDb } from "./workflow-db";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "swarmy-swarm-"));
  dirs.push(dir);
  return dir;
}

it("importing examples/cycle.json packaged as .swarm fails and does not create a workflow row", async () => {
  const db = openWorkflowDb(await tempDir());
  try {
    const workflowJson = readFileSync(resolve("examples", "cycle.json"), "utf8");
    const bytes = packageSwarmArchive({
      workflowJson,
      promptsJson: "[]",
      requiredEnvVars: [],
    });

    expect(() => importSwarmArchive(db, bytes, new Set(), "imported-cycle")).toThrow(/alpha/);
    expect(() => importSwarmArchive(db, bytes, new Set(), "imported-cycle")).toThrow(/beta/);
    expect(db.list()).toEqual([]);
  } finally {
    db.close();
  }
});

it("a missing required env var is reported and does not create a workflow row or a secret value", async () => {
  const db = openWorkflowDb(await tempDir());
  try {
    const workflowJson = JSON.stringify({
      id: "qa-export",
      name: "QA",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "qa",
          type: "agent",
          position: { x: 0, y: 0 },
          data: { label: "QA" },
        },
      ],
      edges: [],
    });
    const bytes = packageSwarmArchive({
      workflowJson,
      promptsJson: "[]",
      requiredEnvVars: ["CURSOR_API_KEY"],
    });

    const missing = importSwarmArchive(db, bytes, new Set(), "imported-qa");
    expect(missing.saved).toBe(false);
    expect(missing.missingSecrets).toEqual(["CURSOR_API_KEY"]);
    expect(db.list()).toEqual([]);
    expect(JSON.stringify(missing.workflow)).not.toContain("sk-");
    expect(missing.workflow.requiredEnvVars).toEqual(["CURSOR_API_KEY"]);

    const saved = importSwarmArchive(db, bytes, new Set(["CURSOR_API_KEY"]), "imported-qa");
    expect(saved.saved).toBe(true);
    expect(saved.missingSecrets).toEqual([]);
    expect(db.list().map((row) => row.id)).toEqual(["imported-qa"]);
    expect(JSON.stringify(db.load("imported-qa"))).not.toContain("sk-");
  } finally {
    db.close();
  }
});
