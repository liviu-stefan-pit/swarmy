import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@langchain/langgraph-checkpoint-validation";
import { SqliteCheckpointer } from "./sqlite-checkpointer";

Object.assign(globalThis, {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test: it,
});

const directories: string[] = [];

validate<SqliteCheckpointer>({
  checkpointerName: "@langchain/langgraph-checkpoint-sqlite",
  async createCheckpointer() {
    const dir = await mkdtemp(join(tmpdir(), "swarmy-ckpt-"));
    directories.push(dir);
    return SqliteCheckpointer.open(join(dir, "checkpoints.db"));
  },
  async destroyCheckpointer(checkpointer) {
    checkpointer.close();
  },
});

afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});
