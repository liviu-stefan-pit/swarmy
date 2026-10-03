import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launchSwarmy(): Promise<{ app: ElectronApplication; close: () => Promise<void> }> {
  const dataDir = await mkdtemp(join(tmpdir(), "swarmy-e2e-"));
  const app = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: {
      ...process.env,
      SWARMY_RUNTIME: "fake",
      SWARMY_DATA_DIR: dataDir,
    },
  });

  return {
    app,
    async close() {
      await app.close();
      try {
        await rm(dataDir, { recursive: true, force: true });
      } catch {
        // The database file can stay locked briefly after the window closes.
      }
    },
  };
}
