import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export class SqliteModuleMissingError extends Error {
  constructor(detail: string) {
    super(`node:sqlite is missing: ${detail}`);
    this.name = "SqliteModuleMissingError";
  }
}

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type DatabaseSyncConstructor = new (path: string) => SqliteDatabase;

export function openSqliteDatabase(path: string): SqliteDatabase {
  const DatabaseSync = loadDatabaseSync();
  return new DatabaseSync(path);
}

export function roundTripSqlite(dbPath: string): string {
  const db = openSqliteDatabase(dbPath);
  try {
    db.exec("CREATE TABLE probe (value TEXT)");
    db.prepare("INSERT INTO probe (value) VALUES (?)").run("swarmy");
    const row: unknown = db.prepare("SELECT value FROM probe").get();
    if (!isValueRow(row)) {
      throw new Error("node:sqlite read did not return the inserted row");
    }
    return row.value;
  } finally {
    db.close();
  }
}

export function probeSqlite(): string {
  const dir = mkdtempSync(join(tmpdir(), "swarmy-sqlite-"));
  try {
    return roundTripSqlite(join(dir, "probe.db"));
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A locked temp file must not hide a successful round trip.
    }
  }
}

function loadDatabaseSync(): DatabaseSyncConstructor {
  try {
    const loaded: unknown = require("node:sqlite");
    if (!isSqliteModule(loaded)) {
      throw new SqliteModuleMissingError("DatabaseSync is not exported");
    }
    return loaded.DatabaseSync;
  } catch (error) {
    if (error instanceof SqliteModuleMissingError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new SqliteModuleMissingError(detail);
  }
}

function isSqliteModule(value: unknown): value is { DatabaseSync: DatabaseSyncConstructor } {
  return (
    typeof value === "object" &&
    value !== null &&
    "DatabaseSync" in value &&
    typeof value.DatabaseSync === "function"
  );
}

function isValueRow(value: unknown): value is { value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
  );
}
