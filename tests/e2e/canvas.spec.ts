import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

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

test("adds two agent nodes and connects a compatible pair", async () => {
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

    await dropPaletteNode(page, "agent", 80, 160);
    await dropPaletteNode(page, "agent", 420, 160);

    await expect(page.getByTestId("canvas-node")).toHaveCount(2);

    const nodes = page.getByTestId("canvas-node");
    await nodes.nth(0).getByTestId("handle-text-output").dragTo(nodes.nth(1).getByTestId("handle-text-input"));

    await expect(page.getByTestId("canvas-edge")).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("selects an agent, types a prompt, and shows the new label without a reload", async () => {
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

    await dropPaletteNode(page, "agent", 80, 160);
    await page.getByTestId("canvas-node").click();
    await page.getByTestId("inspector-label").fill("Writer");
    await page.getByTestId("inspector-system-prompt").fill("Reply with one sentence.");

    await expect(page.getByTestId("canvas-node").locator("h3")).toHaveText("Writer");
    await expect(page.getByTestId("inspector-system-prompt")).toHaveValue("Reply with one sentence.");
  } finally {
    await app.close();
  }
});
