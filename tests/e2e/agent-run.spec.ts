import { expect, test, type Page } from "@playwright/test";
import { launchSwarmy } from "./launch-app";

const nodeDragType = "application/swarmy-node";

async function dropPaletteNode(page: Page, type: string, x: number, y: number): Promise<void> {
  const canvas = page.getByTestId("workflow-canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("workflow canvas has no box");
  }

  await page.evaluate(
    ({ dragType, nodeType, clientX, clientY }) => {
      const view = globalThis as unknown as {
        document: { querySelector(selector: string): EventTarget | null };
        DataTransfer: new () => { setData(format: string, value: string): void };
        DragEvent: new (type: string, init: Record<string, unknown>) => Event;
      };
      const palette = view.document.querySelector(`[data-testid="palette-${nodeType}"]`);
      const target = view.document.querySelector('[data-testid="workflow-canvas"]');
      if (!palette || !target) {
        throw new Error("palette or canvas is missing");
      }

      const dataTransfer = new view.DataTransfer();
      dataTransfer.setData(dragType, nodeType);
      const dropAt = { bubbles: true, cancelable: true, clientX, clientY, dataTransfer };
      palette.dispatchEvent(new view.DragEvent("dragstart", { bubbles: true, dataTransfer }));
      target.dispatchEvent(new view.DragEvent("dragover", dropAt));
      target.dispatchEvent(new view.DragEvent("drop", dropAt));
    },
    { dragType: nodeDragType, nodeType: type, clientX: box.x + x, clientY: box.y + y },
  );
}

test("runs one agent on the fake runtime and shows the scripted reply as completed", async () => {
  const { app, close } = await launchSwarmy();

  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("engine-status")).toHaveText("Engine connected");

    await dropPaletteNode(page, "agent", 80, 160);
    await page.getByTestId("run-agent").click();

    await expect(page.getByTestId("run-log")).toContainText("fake-agent-reply");
    await expect(page.getByTestId("node-status")).toHaveText("completed");
  } finally {
    await close();
  }
});
