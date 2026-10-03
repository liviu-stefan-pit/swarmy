import { _electron as electron, expect, test } from "@playwright/test";
import { join } from "node:path";

test("Electron window title is Swarmy", async () => {
  const app = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: {
      ...process.env,
      SWARMY_RUNTIME: "fake",
    },
  });

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
    await app.close();
  }
});
