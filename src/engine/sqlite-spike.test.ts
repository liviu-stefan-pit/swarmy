import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { roundTripSqlite } from "./sqlite-spike";

it("round-trips a row through node:sqlite in a temp file", async ({ skip }) => {
  try {
    await import("node:sqlite");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    skip(true, `node:sqlite is missing: ${detail}`);
  }

  const dir = await mkdtemp(join(tmpdir(), "swarmy-sqlite-"));
  try {
    expect(roundTripSqlite(join(dir, "spike.db"))).toBe("swarmy");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
