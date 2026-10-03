import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { workflowSchema, type Workflow } from "@shared/workflow";
import type { WorkflowSummary } from "@shared/workflows";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite-spike";

export type { WorkflowSummary };

export interface WorkflowDb {
  save(workflow: Workflow): WorkflowSummary;
  load(id: string): Workflow;
  list(): WorkflowSummary[];
  delete(id: string): void;
  close(): void;
}

export function workflowDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SWARMY_DATA_DIR?.trim();
  if (override) {
    return override;
  }
  const appData = env.APPDATA?.trim();
  if (!appData) {
    throw new Error("Set SWARMY_DATA_DIR or APPDATA to store workflows");
  }
  return join(appData, "Swarmy");
}

export function openWorkflowDb(dataDir: string, options?: { now?: () => number }): WorkflowDb {
  mkdirSync(dataDir, { recursive: true });
  const db = openSqliteDatabase(join(dataDir, "swarmy.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      graph TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  const now = options?.now ?? Date.now;

  return {
    save(workflow) {
      return saveWorkflow(db, workflow, now());
    },
    load(id) {
      return loadWorkflow(db, id);
    },
    list() {
      return listWorkflows(db);
    },
    delete(id) {
      db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
    },
    close() {
      db.close();
    },
  };
}

function saveWorkflow(db: SqliteDatabase, workflow: Workflow, updatedAt: number): WorkflowSummary {
  const parsed = workflowSchema.parse(workflow);
  const graph = JSON.stringify(parsed);
  const existing = db.prepare("SELECT created_at FROM workflows WHERE id = ?").get(parsed.id);
  if (isCreatedRow(existing)) {
    db.prepare("UPDATE workflows SET name = ?, graph = ?, updated_at = ? WHERE id = ?").run(
      parsed.name,
      graph,
      updatedAt,
      parsed.id,
    );
    return { id: parsed.id, name: parsed.name, createdAt: existing.created_at, updatedAt };
  }

  db.prepare("INSERT INTO workflows (id, name, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    parsed.id,
    parsed.name,
    graph,
    updatedAt,
    updatedAt,
  );
  return { id: parsed.id, name: parsed.name, createdAt: updatedAt, updatedAt };
}

function loadWorkflow(db: SqliteDatabase, id: string): Workflow {
  const row = db.prepare("SELECT graph FROM workflows WHERE id = ?").get(id);
  if (!isGraphRow(row)) {
    throw new Error(`No workflow with id ${id}`);
  }
  const parsed: unknown = JSON.parse(row.graph);
  return workflowSchema.parse(parsed);
}

function listWorkflows(db: SqliteDatabase): WorkflowSummary[] {
  const rows: unknown = db
    .prepare("SELECT id, name, created_at, updated_at FROM workflows ORDER BY updated_at DESC, id ASC")
    .all();
  if (!Array.isArray(rows)) {
    throw new Error("workflow list returned an unexpected row");
  }
  return rows.map((row) => {
    if (!isSummaryRow(row)) {
      throw new Error("workflow list returned an unexpected row");
    }
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreatedRow(value: unknown): value is { created_at: number } {
  return isRecord(value) && typeof value.created_at === "number";
}

function isGraphRow(value: unknown): value is { graph: string } {
  return isRecord(value) && typeof value.graph === "string";
}

function isSummaryRow(value: unknown): value is { id: string; name: string; created_at: number; updated_at: number } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.created_at === "number" &&
    typeof value.updated_at === "number"
  );
}
