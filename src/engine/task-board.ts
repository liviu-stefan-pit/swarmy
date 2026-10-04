import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { boardTaskSchema, type BoardTask } from "@shared/runs";
import type { RuntimeCustomTool, RuntimeJson } from "./runtime";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite-spike";

const updateTaskArgsSchema = boardTaskSchema;

export interface TaskBoardTools {
  update_task: RuntimeCustomTool;
  inspect_board: RuntimeCustomTool;
}

export interface TaskBoard {
  tools(runId: string, onChange?: (tasks: BoardTask[]) => void): TaskBoardTools;
  list(runId: string): BoardTask[];
  close(): void;
}

export function openTaskBoard(dbPath: string): TaskBoard {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openSqliteDatabase(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_tasks (
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      PRIMARY KEY (run_id, task_id)
    )
  `);
  let pending: Promise<unknown> = Promise.resolve();

  return {
    tools(runId, onChange) {
      return {
        update_task: {
          description:
            "Post or replace one task on this run's board. Arguments are id, owner, status, and summary.",
          inputSchema: updateTaskInputSchema,
          execute(args) {
            return exclusive(pending, (next) => {
              pending = next;
            }, () => writeTask(db, runId, args, onChange));
          },
        },
        inspect_board: {
          description: "Read the tasks on this run's board. Tasks from other runs are not included.",
          inputSchema: { type: "object", properties: {} },
          execute() {
            return exclusive(pending, (next) => {
              pending = next;
            }, () => JSON.stringify(listTasks(db, runId)));
          },
        },
      };
    },
    list(runId) {
      return listTasks(db, runId);
    },
    close() {
      db.close();
    },
  };
}

const updateTaskInputSchema: { [key: string]: RuntimeJson } = {
  type: "object",
  properties: {
    id: { type: "string" },
    owner: { type: "string" },
    status: { type: "string" },
    summary: { type: "string" },
  },
  required: ["id", "owner", "status", "summary"],
};

function writeTask(
  db: SqliteDatabase,
  runId: string,
  args: Record<string, unknown>,
  onChange: ((tasks: BoardTask[]) => void) | undefined,
): string {
  const parsed = updateTaskArgsSchema.safeParse(args);
  if (!parsed.success) {
    return "task payload was not accepted";
  }
  db.prepare(
    `INSERT INTO board_tasks (run_id, task_id, owner, status, summary)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(run_id, task_id) DO UPDATE SET
       owner = excluded.owner,
       status = excluded.status,
       summary = excluded.summary`,
  ).run(runId, parsed.data.id, parsed.data.owner, parsed.data.status, parsed.data.summary);
  const tasks = listTasks(db, runId);
  onChange?.(tasks);
  return "task updated";
}

function listTasks(db: SqliteDatabase, runId: string): BoardTask[] {
  const rows: unknown = db.prepare(
    `SELECT task_id, owner, status, summary
     FROM board_tasks
     WHERE run_id = ?
     ORDER BY task_id`,
  ).all(runId);
  if (!Array.isArray(rows)) {
    return [];
  }
  const tasks: BoardTask[] = [];
  for (const row of rows) {
    if (!isStoredTask(row)) {
      throw new Error("task row was not readable");
    }
    tasks.push(
      boardTaskSchema.parse({
        id: row.task_id,
        owner: row.owner,
        status: row.status,
        summary: row.summary,
      }),
    );
  }
  return tasks;
}

function isStoredTask(value: unknown): value is { task_id: string; owner: string; status: string; summary: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "task_id" in value &&
    "owner" in value &&
    "status" in value &&
    "summary" in value &&
    typeof value.task_id === "string" &&
    typeof value.owner === "string" &&
    typeof value.status === "string" &&
    typeof value.summary === "string"
  );
}

function exclusive<T>(
  pending: Promise<unknown>,
  remember: (next: Promise<unknown>) => void,
  work: () => T,
): Promise<T> {
  const result = pending.then(work, work);
  remember(
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
