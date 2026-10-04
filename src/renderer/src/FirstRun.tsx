import type { ConnectionInfo } from "@shared/settings";
import { SettingsForm } from "./SettingsForm";

interface WorkflowState {
  name: string;
  apiKey?: string;
}

export function FirstRun({
  dataDirectory,
  workflow,
  onWorkflowChange,
  onSaveKey,
  keySaved,
  busy,
  connection,
  error,
  onTestConnection,
  onContinue,
}: {
  dataDirectory: string;
  workflow: WorkflowState;
  onWorkflowChange: (workflow: WorkflowState) => void;
  onSaveKey: (apiKey: string) => void | Promise<void>;
  keySaved: boolean;
  busy: boolean;
  connection: ConnectionInfo | undefined;
  error: string;
  onTestConnection: () => void;
  onContinue: () => void;
}) {
  return (
    <section data-testid="first-run" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 overflow-auto px-6 py-8">
      <div>
        <h2 className="text-base font-medium text-zinc-50">Set up Swarmy</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Workflows and the API key are stored in this folder on this PC.
        </p>
      </div>
      <div>
        <p className="text-sm text-zinc-300">Data directory</p>
        <p data-testid="data-directory" className="mt-1 break-all font-mono text-sm text-zinc-100">
          {dataDirectory}
        </p>
      </div>
      <SettingsForm workflow={workflow} onWorkflowChange={onWorkflowChange} onSaveKey={onSaveKey} />
      <p data-testid="key-status" className="text-sm text-zinc-300">
        {keySaved ? "Key saved" : "No key saved"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="test-connection"
          disabled={!keySaved || busy}
          className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
          onClick={onTestConnection}
        >
          Test connection
        </button>
        <button
          type="button"
          data-testid="first-run-continue"
          disabled={!connection}
          className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
      {connection ? (
        <div data-testid="connection-result" className="space-y-1 text-sm text-zinc-200">
          <p data-testid="account-label">{connection.accountLabel}</p>
          <p data-testid="model-ids">{connection.modelIds.join(", ")}</p>
        </div>
      ) : null}
      {error ? (
        <p data-testid="cursor-error" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
