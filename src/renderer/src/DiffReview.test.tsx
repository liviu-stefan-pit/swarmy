import { expect, it, vi } from "vitest";

vi.mock("monaco-editor", () => ({ editor: {} }));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor() {
    return null;
  },
  loader: { config() {} },
}));
vi.mock("monaco-editor/editor/editor.worker.js?worker", () => ({ default: class EditorWorker {} }));
vi.mock("monaco-editor/language/css/css.worker.js?worker", () => ({ default: class CssWorker {} }));
vi.mock("monaco-editor/language/html/html.worker.js?worker", () => ({ default: class HtmlWorker {} }));
vi.mock("monaco-editor/language/json/json.worker.js?worker", () => ({ default: class JsonWorker {} }));
vi.mock("monaco-editor/language/typescript/ts.worker.js?worker", () => ({ default: class TsWorker {} }));
vi.mock("monaco-editor/min/vs/editor/editor.main.css", () => ({}));

it("registers the Monaco worker factory before the diff editor loads", async () => {
  await import("./DiffReview");

  expect(typeof globalThis.MonacoEnvironment?.getWorker).toBe("function");
});
