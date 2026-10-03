import { useState } from "react";

interface WorkflowState {
  name: string;
  apiKey?: string;
}

export function SettingsForm({
  workflow,
  onSaveKey,
  onWorkflowChange,
}: {
  workflow: WorkflowState;
  onSaveKey: (apiKey: string) => void | Promise<void>;
  onWorkflowChange?: (workflow: WorkflowState) => void;
}) {
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="space-y-2">
      <label htmlFor="api-key" className="block text-sm text-zinc-300">
        API key
      </label>
      <input
        id="api-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={apiKey}
        data-testid="api-key"
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50"
        onChange={(event) => {
          setApiKey(event.target.value);
        }}
      />
      <button
        type="button"
        data-testid="save-api-key"
        className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
        onClick={() => {
          const trimmed = apiKey.trim();
          if (!trimmed) {
            return;
          }
          onWorkflowChange?.(workflow);
          void Promise.resolve(onSaveKey(trimmed)).then(
            () => {
              setApiKey("");
            },
            () => {
              // Leave the field filled so a failed save can be retried.
            },
          );
        }}
      >
        Save
      </button>
      <p className="text-xs text-zinc-500">The key is stored encrypted and is not shown again.</p>
    </div>
  );
}
