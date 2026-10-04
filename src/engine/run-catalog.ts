import { openSqliteDatabase, type SqliteDatabase } from "./sqlite-spike";

export type WorkflowRunRecordStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "budget_exceeded";

export type RunCostState = "pending" | "known";

export interface RunNodeRecordInput {
  threadId: string;
  nodeId: string;
  transcript: string;
  totalTokens: number | undefined;
  chargedCents: number | undefined;
}

export interface RunHistoryEntry {
  threadId: string;
  status: WorkflowRunRecordStatus;
  startedAt: number;
  endedAt: number | null;
}

export interface RunHistoryNode {
  nodeId: string;
  transcript: string;
  totalTokens: number | null;
  costState: RunCostState;
  chargedCents: number | null;
}

export interface RunHistoryDetail extends RunHistoryEntry {
  nodes: RunHistoryNode[];
}

export interface RunAgentRef {
  nodeId: string;
  agentId: string;
}

export interface RunCatalog {
  markRunning(threadId: string, workflowId: string): void;
  markFinished(threadId: string, status: Exclude<WorkflowRunRecordStatus, "running">): void;
  rememberAgent(threadId: string, nodeId: string, agentId: string): void;
  agentId(threadId: string, nodeId: string): string | undefined;
  agents(threadId: string): RunAgentRef[];
  recordNode(input: RunNodeRecordInput): void;
  knownChargedCents(threadId: string): number;
  knownTotalTokens(threadId: string): number;
  setChargedCents(threadId: string, nodeId: string, chargedCents: number): void;
  listRuns(workflowId: string): RunHistoryEntry[];
  runDetail(threadId: string): RunHistoryDetail;
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
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER
    )
  `);
  ensureColumn(db, "workflow_runs", "started_at", "INTEGER");
  ensureColumn(db, "workflow_runs", "ended_at", "INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_agents (
      thread_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, node_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_nodes (
      thread_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      transcript TEXT NOT NULL,
      total_tokens INTEGER,
      cost_state TEXT NOT NULL,
      charged_cents REAL,
      PRIMARY KEY (thread_id, node_id)
    )
  `);

  return {
    markRunning(threadId, workflowId) {
      const now = Date.now();
      db.prepare(
        `INSERT INTO workflow_runs (thread_id, workflow_id, status, updated_at, started_at, ended_at)
         VALUES (?, ?, 'running', ?, ?, NULL)
         ON CONFLICT(thread_id) DO UPDATE SET
           workflow_id = excluded.workflow_id,
           status = 'running',
           updated_at = excluded.updated_at,
           started_at = COALESCE(workflow_runs.started_at, excluded.started_at),
           ended_at = NULL`,
      ).run(threadId, workflowId, now, now);
    },
    markFinished(threadId, status) {
      const now = Date.now();
      db.prepare(
        "UPDATE workflow_runs SET status = ?, updated_at = ?, ended_at = ? WHERE thread_id = ?",
      ).run(status, now, now, threadId);
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
    agents(threadId) {
      const rows: unknown = db
        .prepare("SELECT node_id, agent_id FROM run_agents WHERE thread_id = ? ORDER BY node_id ASC")
        .all(threadId);
      if (!Array.isArray(rows)) {
        return [];
      }
      return rows.filter(isAgentRef).map((row) => ({ nodeId: row.node_id, agentId: row.agent_id }));
    },
    recordNode(input) {
      const pending = input.chargedCents === undefined;
      db.prepare(
        `INSERT INTO run_nodes (thread_id, node_id, transcript, total_tokens, cost_state, charged_cents)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, node_id) DO UPDATE SET
           transcript = excluded.transcript,
           total_tokens = excluded.total_tokens,
           cost_state = excluded.cost_state,
           charged_cents = excluded.charged_cents`,
      ).run(
        input.threadId,
        input.nodeId,
        input.transcript,
        input.totalTokens === undefined ? null : input.totalTokens,
        pending ? "pending" : "known",
        pending ? null : input.chargedCents,
      );
    },
    knownChargedCents(threadId) {
      const row: unknown = db
        .prepare(
          `SELECT COALESCE(SUM(charged_cents), 0) AS spent
           FROM run_nodes
           WHERE thread_id = ? AND cost_state = 'known'`,
        )
        .get(threadId);
      return isSpentRow(row) ? row.spent : 0;
    },
    knownTotalTokens(threadId) {
      const row: unknown = db
        .prepare(
          `SELECT COALESCE(SUM(total_tokens), 0) AS spent
           FROM run_nodes
           WHERE thread_id = ? AND total_tokens IS NOT NULL`,
        )
        .get(threadId);
      return isSpentRow(row) ? row.spent : 0;
    },
    setChargedCents(threadId, nodeId, chargedCents) {
      db.prepare(
        `UPDATE run_nodes
         SET cost_state = 'known', charged_cents = ?
         WHERE thread_id = ? AND node_id = ?`,
      ).run(chargedCents, threadId, nodeId);
    },
    listRuns(workflowId) {
      const rows: unknown = db
        .prepare(
          `SELECT thread_id, status, started_at, ended_at, updated_at
           FROM workflow_runs
           WHERE workflow_id = ?
           ORDER BY COALESCE(started_at, updated_at) DESC, thread_id ASC`,
        )
        .all(workflowId);
      if (!Array.isArray(rows)) {
        return [];
      }
      return rows.filter(isHistoryRow).map(toHistoryEntry);
    },
    runDetail(threadId) {
      const row: unknown = db
        .prepare(
          `SELECT thread_id, status, started_at, ended_at, updated_at
           FROM workflow_runs
           WHERE thread_id = ?`,
        )
        .get(threadId);
      if (!isHistoryRow(row)) {
        throw new Error(`No run with id ${threadId}`);
      }
      const nodes: unknown = db
        .prepare(
          `SELECT node_id, transcript, total_tokens, cost_state, charged_cents
           FROM run_nodes
           WHERE thread_id = ?
           ORDER BY node_id ASC`,
        )
        .all(threadId);
      return {
        ...toHistoryEntry(row),
        nodes: Array.isArray(nodes) ? nodes.filter(isNodeHistoryRow).map(toHistoryNode) : [],
      };
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

function ensureColumn(db: SqliteDatabase, table: string, name: string, definition: string): void {
  if (columnNames(db, table).has(name)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function columnNames(db: SqliteDatabase, table: string): Set<string> {
  const rows: unknown = db.prepare(`PRAGMA table_info(${table})`).all();
  const names = new Set<string>();
  if (!Array.isArray(rows)) {
    return names;
  }
  for (const row of rows) {
    if (isRecord(row) && typeof row.name === "string") {
      names.add(row.name);
    }
  }
  return names;
}

function toHistoryEntry(row: HistoryRow): RunHistoryEntry {
  return {
    threadId: row.thread_id,
    status: runStatus(row.status),
    startedAt: row.started_at ?? row.updated_at,
    endedAt: row.ended_at,
  };
}

function toHistoryNode(row: NodeHistoryRow): RunHistoryNode {
  return {
    nodeId: row.node_id,
    transcript: row.transcript,
    totalTokens: row.total_tokens,
    costState: row.cost_state === "known" ? "known" : "pending",
    chargedCents: row.cost_state === "known" ? row.charged_cents : null,
  };
}

function runStatus(status: string): WorkflowRunRecordStatus {
  switch (status) {
    case "running":
    case "completed":
    case "cancelled":
    case "failed":
    case "budget_exceeded":
      return status;
    default:
      return "failed";
  }
}

function isAgentRow(value: unknown): value is { agent_id: string } {
  return isRecord(value) && typeof value.agent_id === "string";
}

function isAgentRef(value: unknown): value is { node_id: string; agent_id: string } {
  return isRecord(value) && typeof value.node_id === "string" && typeof value.agent_id === "string";
}

function isThreadRow(value: unknown): value is { thread_id: string } {
  return isRecord(value) && typeof value.thread_id === "string";
}

function isSpentRow(value: unknown): value is { spent: number } {
  return isRecord(value) && typeof value.spent === "number";
}

interface HistoryRow {
  thread_id: string;
  status: string;
  started_at: number | null;
  ended_at: number | null;
  updated_at: number;
}

function isHistoryRow(value: unknown): value is HistoryRow {
  return (
    isRecord(value) &&
    typeof value.thread_id === "string" &&
    typeof value.status === "string" &&
    (value.started_at === null || typeof value.started_at === "number") &&
    (value.ended_at === null || typeof value.ended_at === "number") &&
    typeof value.updated_at === "number"
  );
}

interface NodeHistoryRow {
  node_id: string;
  transcript: string;
  total_tokens: number | null;
  cost_state: string;
  charged_cents: number | null;
}

function isNodeHistoryRow(value: unknown): value is NodeHistoryRow {
  return (
    isRecord(value) &&
    typeof value.node_id === "string" &&
    typeof value.transcript === "string" &&
    (value.total_tokens === null || typeof value.total_tokens === "number") &&
    typeof value.cost_state === "string" &&
    (value.charged_cents === null || typeof value.charged_cents === "number")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
