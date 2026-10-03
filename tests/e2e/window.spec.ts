import { expect, test } from "@playwright/test";
import { launchSwarmy } from "./launch-app";

test("Electron window title is Swarmy", async () => {
  const { app, close } = await launchSwarmy();

  try {
    await app.firstWindow();
    const { title, runtime } = await app.evaluate(({ BrowserWindow }) => {
      return {
        title: BrowserWindow.getAllWindows()[0]?.getTitle() ?? "",
        runtime: process.env.SWARMY_RUNTIME ?? "",
      };
    });
    expect(runtime).toBe("fake");
    expect(title).toBe("Swarmy");
  } finally {
    await close();
  }
});
