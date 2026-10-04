import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launchSwarmy(
  env: Record<string, string> = {},
  options: { seedKey?: boolean; dataDir?: string } = {},
): Promise<{ app: ElectronApplication; dataDir: string; close: () => Promise<void> }> {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "swarmy-e2e-")));
  const ownsDataDir = options.dataDir === undefined;
  const seedKey = options.seedKey !== false;
  const app = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: {
      ...process.env,
      SWARMY_RUNTIME: "fake",
      SWARMY_DATA_DIR: dataDir,
      SWARMY_WORKSPACES_DIR: join(dataDir, "workspaces"),
      ...env,
      SWARMY_E2E_SEED_KEY: seedKey ? "cursor_test_key_do_not_send" : "",
    },
  });

  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000);
  });
  await page.waitForFunction("() => window.innerWidth >= 1200");

  return {
    app,
    dataDir,
    async close() {
      await app.close();
      if (!ownsDataDir) {
        return;
      }
      try {
        await rm(dataDir, { recursive: true, force: true });
      } catch {
        // The database file can stay locked briefly after the window closes.
      }
    },
  };
}
