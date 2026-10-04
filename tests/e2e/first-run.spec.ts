import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchSwarmy } from "./launch-app";

test("first-run is shown when no key is stored and skipped when a key is stored", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "swarmy-first-run-"));
  const first = await launchSwarmy({}, { seedKey: false, dataDir });

  try {
    const page = await first.app.firstWindow();
    await expect(page.getByTestId("first-run")).toBeVisible();
    await expect(page.getByTestId("data-directory")).toHaveText(dataDir);
    await expect(page.getByTestId("workflow-canvas")).toHaveCount(0);

    await page.getByTestId("api-key").fill("cursor_test_key_do_not_send");
    await page.getByTestId("save-api-key").click();
    await expect(page.getByTestId("key-status")).toHaveText("Key saved");
    await page.getByTestId("test-connection").click();
    await expect(page.getByTestId("account-label")).toHaveText("fake@swarmy.local");
    await page.getByTestId("first-run-continue").click();
    await expect(page.getByTestId("workflow-canvas")).toBeVisible();
    await expect(page.getByTestId("first-run")).toHaveCount(0);
  } finally {
    await first.close();
  }

  const second = await launchSwarmy({}, { seedKey: false, dataDir });
  try {
    const page = await second.app.firstWindow();
    await expect(page.getByTestId("workflow-canvas")).toBeVisible();
    await expect(page.getByTestId("first-run")).toHaveCount(0);
  } finally {
    await second.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
