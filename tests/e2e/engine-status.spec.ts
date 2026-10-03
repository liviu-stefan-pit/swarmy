import { _electron as electron, expect, test } from "@playwright/test";
import { join } from "node:path";

test("engine status becomes Engine connected", async () => {
  const app = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: {
      ...process.env,
      SWARMY_RUNTIME: "fake",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("engine-status")).toHaveText("Engine connected");
  } finally {
    await app.close();
  }
});
