import { expect, test } from "@playwright/test";
import { launchSwarmy } from "./launch-app";

test("engine status becomes Engine connected", async () => {
  const { app, close } = await launchSwarmy();

  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("engine-status")).toHaveText("Engine connected");
  } finally {
    await close();
  }
});
