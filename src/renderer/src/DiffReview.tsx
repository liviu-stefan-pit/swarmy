import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import "monaco-editor/min/vs/editor/editor.main.css";

loader.config({ monaco });

globalThis.MonacoEnvironment = {
  getWorker(workerId, label) {
    void workerId;
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

export function DiffReview({
  path,
  original,
  modified,
  onChange,
}: {
  path: string;
  original: string;
  modified: string;
  onChange: (text: string) => void;
}) {
  const [initialModified] = useState(modified);
  const listener = useRef<monaco.IDisposable | null>(null);

  useEffect(() => {
    return () => {
      listener.current?.dispose();
    };
  }, []);

  return (
    <DiffEditor
      height="240px"
      theme="vs-dark"
      language={languageFor(path)}
      original={original}
      modified={initialModified}
      options={{
        renderSideBySide: true,
        originalEditable: false,
        useInlineViewWhenSpaceIsLimited: false,
        automaticLayout: true,
        readOnly: false,
      }}
      onMount={(instance) => {
        const modifiedEditor = instance.getModifiedEditor();
        listener.current?.dispose();
        listener.current = modifiedEditor.onDidChangeModelContent(() => {
          onChange(modifiedEditor.getValue());
        });
      }}
    />
  );
}

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "py":
      return "python";
    default:
      return "plaintext";
  }
}
