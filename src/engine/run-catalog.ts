import { openSqliteDatabase } from "./sqlite-spike";

export type WorkflowRunRecordStatus = "running" | "completed" | "cancelled" | "failed";

export interface RunCatalog {
  markRunning(threadId: string, workflowId: string): void;
  markFinished(threadId: string, status: Exclude<WorkflowRunRecordStatus, "running">): void;
  rememberAgent(threadId: string, nodeId: string, agentId: string): void;
  agentId(threadId: string, nodeId: string): string | undefined;
  unfinished(workflowId: string): { threadId: string } | undefined;
  close(): void;
}

export function openRunCatalog(path: string): RunCatalog {
  const db = openSqliteDatabase(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      thread_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_agents (
      thread_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, node_id)
    )
  `);

  return {
    markRunning(threadId, workflowId) {
      db.prepare(
        `INSERT INTO workflow_runs (thread_id, workflow_id, status, updated_at)
         VALUES (?, ?, 'running', ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           workflow_id = excluded.workflow_id,
           status = 'running',
           updated_at = excluded.updated_at`,
      ).run(threadId, workflowId, Date.now());
    },
    markFinished(threadId, status) {
      db.prepare("UPDATE workflow_runs SET status = ?, updated_at = ? WHERE thread_id = ?").run(
        status,
        Date.now(),
        threadId,
      );
    },
    rememberAgent(threadId, nodeId, agentId) {
      db.prepare(
        `INSERT INTO run_agents (thread_id, node_id, agent_id)
         VALUES (?, ?, ?)
         ON CONFLICT(thread_id, node_id) DO UPDATE SET agent_id = excluded.agent_id`,
      ).run(threadId, nodeId, agentId);
    },
    agentId(threadId, nodeId) {
      const row: unknown = db
        .prepare("SELECT agent_id FROM run_agents WHERE thread_id = ? AND node_id = ?")
        .get(threadId, nodeId);
      return isAgentRow(row) ? row.agent_id : undefined;
    },
    unfinished(workflowId) {
      const row: unknown = db
        .prepare(
          `SELECT thread_id FROM workflow_runs
           WHERE workflow_id = ? AND status = 'running'
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(workflowId);
      return isThreadRow(row) ? { threadId: row.thread_id } : undefined;
    },
    close() {
      db.close();
    },
  };
}

function isAgentRow(value: unknown): value is { agent_id: string } {
  return isRow(value) && typeof value.agent_id === "string";
}

function isThreadRow(value: unknown): value is { thread_id: string } {
  return isRow(value) && typeof value.thread_id === "string";
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function unfinishedThread(path: string, workflowId: string): string | undefined {
  let catalog: RunCatalog | undefined;
  try {
    catalog = openRunCatalog(path);
    return catalog.unfinished(workflowId)?.threadId;
  } catch {
    return undefined;
  } finally {
    catalog?.close();
  }
}
