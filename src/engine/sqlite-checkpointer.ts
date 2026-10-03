import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  TASKS,
  WRITES_IDX_MAP,
  copyCheckpoint,
  maxChannelVersion,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite-spike";

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
}

interface WriteRow {
  task_id: string;
  idx: number;
  channel: string;
  type: string | null;
  value: Uint8Array | null;
}

export class SqliteCheckpointer extends BaseCheckpointSaver {
  private ready = false;

  private constructor(private readonly db: SqliteDatabase) {
    super();
  }

  static open(path: string): SqliteCheckpointer {
    return new SqliteCheckpointer(openSqliteDatabase(path));
  }

  close(): void {
    this.db.close();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();
    const threadId = config.configurable?.thread_id;
    const checkpointNs = namespaceOf(config);
    const checkpointId = config.configurable?.checkpoint_id;
    if (typeof threadId !== "string") {
      return undefined;
    }

    const row = checkpointId
      ? this.db
          .prepare(
            `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
             FROM checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          )
          .get(threadId, checkpointNs, checkpointId)
      : this.db
          .prepare(
            `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
             FROM checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC
             LIMIT 1`,
          )
          .get(threadId, checkpointNs);

    if (!isCheckpointRow(row)) {
      return undefined;
    }
    return this.toTuple(row, checkpointId ? config : undefined);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();
    const { limit, before, filter } = options ?? {};
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns;
    const where: string[] = [];
    const args: unknown[] = [];

    if (typeof threadId === "string") {
      where.push("thread_id = ?");
      args.push(threadId);
    }
    if (checkpointNs !== undefined && checkpointNs !== null) {
      where.push("checkpoint_ns = ?");
      args.push(checkpointNs);
    }
    const beforeId = before?.configurable?.checkpoint_id;
    if (typeof beforeId === "string") {
      where.push("checkpoint_id < ?");
      args.push(beforeId);
    }

    const sanitized = Object.entries(filter ?? {}).filter((entry) => entry[1] !== undefined);
    for (const [key, value] of sanitized) {
      where.push("jsonb(CAST(metadata AS TEXT))->? = ?");
      args.push(`$.${key}`, JSON.stringify(value));
    }

    let sql = `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata FROM checkpoints`;
    if (where.length > 0) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += " ORDER BY checkpoint_id DESC";
    const safeLimit = typeof limit === "number" ? Math.trunc(limit) : 0;
    if (safeLimit > 0) {
      sql += ` LIMIT ${safeLimit}`;
    }

    const rows = this.db.prepare(sql).all(...args);
    if (!Array.isArray(rows)) {
      return;
    }
    for (const row of rows) {
      if (!isCheckpointRow(row)) {
        continue;
      }
      yield await this.toTuple(row);
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, number | string>,
  ): Promise<RunnableConfig> {
    void _newVersions;
    this.setup();
    const threadId = config.configurable?.thread_id;
    if (!config.configurable || typeof threadId !== "string") {
      throw new Error('Missing "thread_id" field in passed "config.configurable".');
    }
    const checkpointNs = namespaceOf(config);
    const parentId = config.configurable.checkpoint_id;
    const prepared = copyCheckpoint(checkpoint);
    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ]);
    if (checkpointType !== metadataType) {
      throw new Error("Failed to serialize checkpoint and metadata to the same type.");
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        typeof parentId === "string" ? parentId : null,
        checkpointType,
        checkpointBytes,
        metadataBytes,
      );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    this.setup();
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    if (!config.configurable || typeof threadId !== "string") {
      throw new Error("Missing thread_id field in config.configurable.");
    }
    if (typeof checkpointId !== "string") {
      throw new Error("Missing checkpoint_id field in config.configurable.");
    }
    const checkpointNs = config.configurable.checkpoint_ns ?? "";
    const replace = writes.every(([channel]) => Object.prototype.hasOwnProperty.call(WRITES_IDX_MAP, channel));
    const sql = `INSERT ${replace ? "OR REPLACE" : "OR IGNORE"} INTO writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const rows = await Promise.all(
      writes.map(async (write, index) => {
        const [type, value] = await this.serde.dumpsTyped(write[1]);
        const channel = write[0];
        return [
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          WRITES_IDX_MAP[channel] ?? index,
          channel,
          type,
          value,
        ];
      }),
    );

    this.transaction(() => {
      const statement = this.db.prepare(sql);
      for (const row of rows) {
        statement.run(...row);
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    this.setup();
    this.transaction(() => {
      this.db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
      this.db.prepare("DELETE FROM writes WHERE thread_id = ?").run(threadId);
    });
  }

  private setup(): void {
    if (this.ready) {
      return;
    }
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      )
    `);
    this.ready = true;
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private async toTuple(row: CheckpointRow, requested?: RunnableConfig): Promise<CheckpointTuple> {
    const checkpointNs = row.checkpoint_ns;
    const config = requested ?? {
      configurable: {
        thread_id: row.thread_id,
        checkpoint_ns: checkpointNs,
        checkpoint_id: row.checkpoint_id,
      },
    };
    const writes = this.readWrites(row.thread_id, checkpointNs, row.checkpoint_id);
    const pendingWrites = await Promise.all(
      writes.map(async (write) => {
        const value = await this.serde.loadsTyped(write.type ?? "json", write.value ?? new Uint8Array());
        return [write.task_id, write.channel, value] as [string, string, unknown];
      }),
    );
    const checkpoint = (await this.serde.loadsTyped(
      row.type ?? "json",
      row.checkpoint,
    )) as Checkpoint;
    if (checkpoint.v < 4 && row.parent_checkpoint_id) {
      await this.migratePendingSends(checkpoint, row.thread_id, row.parent_checkpoint_id);
    }
    const metadata = (await this.serde.loadsTyped(row.type ?? "json", row.metadata)) as CheckpointMetadata;
    return {
      config,
      checkpoint,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  private readWrites(threadId: string, checkpointNs: string, checkpointId: string): WriteRow[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, idx, channel, type, value
         FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY idx ASC`,
      )
      .all(threadId, checkpointNs, checkpointId);
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.filter(isWriteRow);
  }

  private async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    parentCheckpointId: string,
  ): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT type, value FROM writes
         WHERE thread_id = ? AND checkpoint_id = ? AND channel = ?
         ORDER BY rowid ASC`,
      )
      .all(threadId, parentCheckpointId, TASKS);
    const sends = Array.isArray(rows) ? rows.filter(isSendRow) : [];
    checkpoint.channel_values ??= {};
    checkpoint.channel_values[TASKS] = await Promise.all(
      sends.map((send) => this.serde.loadsTyped(send.type ?? "json", send.value ?? new Uint8Array())),
    );
    const versions = Object.values(checkpoint.channel_versions);
    checkpoint.channel_versions[TASKS] = versions.length > 0 ? maxChannelVersion(...versions) : this.getNextVersion(undefined);
  }
}

function namespaceOf(config: RunnableConfig): string {
  const namespace = config.configurable?.checkpoint_ns;
  return typeof namespace === "string" ? namespace : "";
}

function isCheckpointRow(value: unknown): value is CheckpointRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.thread_id === "string" &&
    typeof value.checkpoint_ns === "string" &&
    typeof value.checkpoint_id === "string" &&
    (value.parent_checkpoint_id === null || typeof value.parent_checkpoint_id === "string") &&
    (value.type === null || typeof value.type === "string") &&
    value.checkpoint instanceof Uint8Array &&
    value.metadata instanceof Uint8Array
  );
}

function isWriteRow(value: unknown): value is WriteRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.task_id === "string" &&
    typeof value.idx === "number" &&
    typeof value.channel === "string" &&
    (value.type === null || typeof value.type === "string") &&
    (value.value === null || value.value instanceof Uint8Array)
  );
}

function isSendRow(value: unknown): value is { type: string | null; value: Uint8Array | null } {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.type === null || typeof value.type === "string") &&
    (value.value === null || value.value instanceof Uint8Array)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
