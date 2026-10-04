import { useEffect, useState } from "react";
import { appInfo } from "@shared/app-info";
import type { EngineStatus } from "@shared/protocol";
import type { ConnectionInfo, HelloInfo } from "@shared/settings";
import { ApprovalInbox } from "./ApprovalInbox";
import { RunHistory } from "./RunHistory";
import { RunLog } from "./RunLog";
import { SettingsForm } from "./SettingsForm";
import { WorkflowEditor } from "./WorkflowCanvas";

function engineStatusLabel(status: EngineStatus): string {
  switch (status) {
    case "connected":
      return "Engine connected";
    case "reconnecting":
      return "Engine reconnecting";
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "The request failed";
  const wrapped = message.match(/^Error invoking remote method '[^']+': Error: ([\s\S]*)$/);
  return wrapped?.[1] ?? message;
}

export function App() {
  const { name } = appInfo();
  const [status, setStatus] = useState<EngineStatus>("reconnecting");
  const [workflow, setWorkflow] = useState<{ name: string; apiKey?: string }>({ name: "Untitled" });
  const [keySaved, setKeySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<ConnectionInfo | undefined>();
  const [hello, setHello] = useState<HelloInfo | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = name;
  }, [name]);

  useEffect(() => {
    return window.swarmy.engine.onStatus(setStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.swarmy.settings.hasKey().then((saved) => {
      if (!cancelled) {
        setKeySaved(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function testConnection(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setConnection(await window.swarmy.settings.testConnection());
    } catch (caught) {
      setConnection(undefined);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runHello(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setHello(await window.swarmy.settings.runHello());
    } catch (caught) {
      setHello(undefined);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-zinc-950 font-sans text-zinc-50">
      <header className="flex items-center border-b border-zinc-800 px-4 py-2">
        <h1 className="text-lg font-semibold tracking-tight">{name}</h1>
      </header>
      <WorkflowEditor />
      <ApprovalInbox />
      <RunHistory />
      <RunLog />
      <details className="border-t border-zinc-800 px-4 py-2">
        <summary className="cursor-pointer text-sm text-zinc-300">Cursor connection</summary>
        <section className="max-w-xl space-y-4 py-3">
          <SettingsForm
            workflow={workflow}
            onWorkflowChange={setWorkflow}
            onSaveKey={async (apiKey) => {
              try {
                await window.swarmy.settings.saveKey(apiKey);
                setKeySaved(true);
                setError("");
              } catch (caught) {
                setError(errorText(caught));
                throw caught;
              }
            }}
          />
          <p data-testid="key-status" className="text-sm text-zinc-300">
            {keySaved ? "Key saved" : "No key saved"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="test-connection"
              disabled={!keySaved || busy}
              className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
              onClick={() => {
                void testConnection();
              }}
            >
              Test connection
            </button>
            <button
              type="button"
              data-testid="run-hello"
              disabled={!keySaved || busy}
              className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
              onClick={() => {
                void runHello();
              }}
            >
              Run hello
            </button>
          </div>
          {connection ? (
            <div data-testid="connection-result" className="space-y-1 text-sm text-zinc-200">
              <p data-testid="account-label">{connection.accountLabel}</p>
              <p data-testid="model-ids">{connection.modelIds.join(", ")}</p>
            </div>
          ) : null}
          {hello ? (
            <div className="space-y-1 text-sm text-zinc-200">
              <p data-testid="hello-result">{hello.text}</p>
              <p data-testid="system-prompt-status">
                {hello.systemPromptAccepted ? "systemPrompt accepted" : "systemPrompt rejected"}
              </p>
              {hello.warning ? <p data-testid="system-prompt-warning">{hello.warning}</p> : null}
              <p data-testid="hello-cwd">Temp directory: {hello.cwd}</p>
            </div>
          ) : null}
          {error ? (
            <p data-testid="cursor-error" className="text-sm text-red-300">
              {error}
            </p>
          ) : null}
        </section>
      </details>
      <footer
        className="border-t border-zinc-800 px-4 py-2 text-sm text-zinc-300"
        data-testid="engine-status"
        title={import.meta.env.DEV ? "Dev: Ctrl+Shift+F9 crashes the engine" : undefined}
      >
        {engineStatusLabel(status)}
      </footer>
    </main>
  );
}
