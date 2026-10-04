import { useEffect, useState } from "react";
import { getNodeType } from "@shared/node-registry";
import {
  mcpTransportSchema,
  workspaceModeSchema,
  type AgentNodeData,
  type FileInputNodeData,
  type FolderInputNodeData,
  type McpNodeData,
  type MergeNodeData,
  type PlannerNodeData,
  type TextInputNodeData,
  type WorkflowNode,
} from "@shared/workflow";
import { useMcpToolsStore } from "./mcp-tools-store";
import type { NodePatch } from "./workflow-store";
import { CollapseControl, IconRail, InspectorIcon, ResizeEdge } from "./PanelChrome";
import { usePanelLayoutStore } from "./panel-layout-store";
import { useWorkflowStore } from "./workflow-store";

const fieldClass =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50";

const variablePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function templateVariableNames(texts: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(variablePattern)) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function toolList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function NodeInspector() {
  const node = useWorkflowStore((state) =>
    state.workflow.nodes.find((item) => item.id === state.selectedNodeId),
  );
  const updateSelectedNode = useWorkflowStore((state) => state.updateSelectedNode);
  const inspectorWidth = usePanelLayoutStore((state) => state.inspectorWidth);
  const collapsed = usePanelLayoutStore((state) => state.inspectorCollapsed);
  const toggleInspector = usePanelLayoutStore((state) => state.toggleInspector);

  if (collapsed) {
    return (
      <IconRail
        railTestId="node-inspector"
        testId="collapse-inspector"
        title="Inspector"
        border="left"
        icon={<InspectorIcon />}
        onToggle={toggleInspector}
      />
    );
  }

  return (
    <aside
      data-testid="node-inspector"
      className="relative flex shrink-0 flex-col border-l border-zinc-800"
      style={{ width: inspectorWidth }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Inspector</h2>
        <CollapseControl
          testId="collapse-inspector"
          title="Inspector"
          collapsed={collapsed}
          onToggle={toggleInspector}
        />
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto px-3 pb-3">
        {node ? (
          <NodeFields node={node} onChange={updateSelectedNode} />
        ) : (
          <p className="text-sm text-zinc-400">Select a node.</p>
        )}
      </div>
      <ResizeEdge
        testId="resize-inspector"
        edge="inspector"
        orientation="vertical"
        label="Resize Inspector"
        className="absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-sky-600"
      />
    </aside>
  );
}

type InspectorPatch = NodePatch;

function NodeFields({
  node,
  onChange,
}: {
  node: WorkflowNode;
  onChange: (patch: InspectorPatch) => void;
}) {
  const definition = getNodeType(node.type);

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-300">{definition?.label ?? node.type}</p>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Label</span>
        <input
          data-testid="inspector-label"
          className={fieldClass}
          value={node.data.label}
          onChange={(event) => {
            if (event.target.value.length === 0) return;
            onChange({ label: event.target.value });
          }}
        />
      </label>
      {node.type === "agent" ? <AgentFields data={node.data} onChange={onChange} /> : null}
      {node.type === "planner" ? <PlannerFields data={node.data} onChange={onChange} /> : null}
      {node.type === "merge" ? <MergeFields data={node.data} onChange={onChange} /> : null}
      {node.type === "textInput" ? <TextFields data={node.data} onChange={onChange} /> : null}
      {node.type === "fileInput" ? <FileFields data={node.data} onChange={onChange} /> : null}
      {node.type === "folderInput" ? <FolderFields data={node.data} onChange={onChange} /> : null}
      {node.type === "mcp" ? <McpFields nodeId={node.id} data={node.data} onChange={onChange} /> : null}
    </div>
  );
}

function MergeFields({
  data,
  onChange,
}: {
  data: MergeNodeData;
  onChange: (patch: InspectorPatch) => void;
}) {
  return (
    <>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Target branch</span>
        <input
          data-testid="inspector-target-branch"
          className={fieldClass}
          value={data.targetBranch}
          placeholder="main"
          onChange={(event) => {
            const targetBranch = event.target.value.trim();
            onChange({ targetBranch: targetBranch.length > 0 ? targetBranch : "main" });
          }}
        />
      </label>
      <p className="text-xs text-zinc-500">
        Upstream repo branches merge into this branch, one at a time. A conflict stops in the inbox and is not resolved
        for you.
      </p>
    </>
  );
}

function PlannerFields({
  data,
  onChange,
}: {
  data: PlannerNodeData;
  onChange: (patch: Partial<AgentNodeData>) => void;
}) {
  return (
    <>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Goal</span>
        <textarea
          data-testid="inspector-goal"
          className={`${fieldClass} min-h-24`}
          value={data.taskPrompt ?? ""}
          placeholder="What should the planner split into tasks?"
          onChange={(event) => {
            onChange({ taskPrompt: event.target.value });
          }}
        />
      </label>
      <p className="text-xs text-zinc-500">
        The planner only reads files and calls submit_plan. A plan can have at most 8 tasks. Each task runs as its own
        worker. Not set uses a managed folder for every worker.
      </p>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Model</span>
        <input
          data-testid="inspector-model"
          className={fieldClass}
          value={data.modelId ?? ""}
          placeholder="Model id"
          onChange={(event) => {
            onChange({ modelId: event.target.value });
          }}
        />
      </label>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Workspace mode</span>
        <select
          data-testid="inspector-workspace-mode"
          className={fieldClass}
          value={data.workspaceMode ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "") {
              onChange({ workspaceMode: undefined });
              return;
            }
            const parsed = workspaceModeSchema.safeParse(value);
            if (!parsed.success) return;
            onChange({ workspaceMode: parsed.data });
          }}
        >
          <option value="">Not set</option>
          <option value="repo">repo</option>
          <option value="managed">managed</option>
          <option value="folder">folder</option>
        </select>
      </label>
      {data.workspaceMode === "folder" ? (
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>Folder</span>
          <input
            data-testid="inspector-folder-path"
            className={fieldClass}
            value={data.folderPath ?? ""}
            placeholder="Folder path"
            onChange={(event) => {
              const folderPath = event.target.value.trim();
              onChange({ folderPath: folderPath.length > 0 ? folderPath : undefined });
            }}
          />
        </label>
      ) : null}
      {data.workspaceMode === "repo" ? <WorkflowRepositoryField /> : null}
    </>
  );
}

function AgentFields({
  data,
  onChange,
}: {
  data: AgentNodeData;
  onChange: (patch: Partial<AgentNodeData>) => void;
}) {
  const variables = templateVariableNames([data.systemPrompt ?? "", data.taskPrompt ?? ""]);

  return (
    <>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Model</span>
        <input
          data-testid="inspector-model"
          className={fieldClass}
          value={data.modelId ?? ""}
          placeholder="Model id"
          onChange={(event) => {
            onChange({ modelId: event.target.value });
          }}
        />
      </label>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>System prompt</span>
        <textarea
          data-testid="inspector-system-prompt"
          className={`${fieldClass} min-h-24`}
          value={data.systemPrompt ?? ""}
          onChange={(event) => {
            onChange({ systemPrompt: event.target.value });
          }}
        />
      </label>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Task prompt</span>
        <textarea
          data-testid="inspector-task-prompt"
          className={`${fieldClass} min-h-24`}
          value={data.taskPrompt ?? ""}
          onChange={(event) => {
            onChange({ taskPrompt: event.target.value });
          }}
        />
      </label>
      <div className="space-y-1">
        <p className="text-xs text-zinc-400">Template variables</p>
        <ul data-testid="inspector-template-variables" className="space-y-1 text-sm text-zinc-200">
          {variables.length === 0 ? (
            <li className="text-zinc-500">None</li>
          ) : (
            variables.map((name) => <li key={name}>{`{{${name}}}`}</li>)
          )}
        </ul>
        <p className="text-xs text-zinc-500">Listed from the prompts. Not filled from upstream yet.</p>
      </div>
      <ToolListField
        label="Tools"
        modeTestId="inspector-tools-mode"
        listTestId="inspector-tools"
        tools={data.tools}
        onChange={(tools) => {
          onChange({ tools });
        }}
      />
      <ToolListField
        label="Disallowed tools"
        modeTestId="inspector-disallowed-tools-mode"
        listTestId="inspector-disallowed-tools"
        tools={data.disallowedTools}
        onChange={(disallowedTools) => {
          onChange({ disallowedTools });
        }}
      />
      <ToggleField
        label="Guardrails"
        testId="inspector-guardrails"
        checked={data.guardrails === true}
        hint="Block dangerous shell commands and writes outside the write paths."
        onChange={(guardrails) => {
          onChange({ guardrails });
        }}
      />
      {data.guardrails === true ? (
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>Write paths</span>
          <textarea
            data-testid="inspector-write-paths"
            className={`${fieldClass} min-h-16`}
            value={(data.writePaths ?? []).join("\n")}
            placeholder="One relative path per line. Empty allows the workspace."
            onChange={(event) => {
              onChange({ writePaths: toolList(event.target.value) });
            }}
          />
          <span className="block text-zinc-500">Relative paths this agent may write. The hook denies the rest.</span>
        </label>
      ) : null}
      <ToggleField
        label="Sandbox"
        testId="inspector-sandbox"
        checked={data.sandboxEnabled === true}
        hint="Run this agent inside Cursor's sandbox."
        onChange={(sandboxEnabled) => {
          onChange({ sandboxEnabled });
        }}
      />
      <ToggleField
        label="Auto-review"
        testId="inspector-auto-review"
        checked={data.autoReview === true}
        hint="Let Cursor auto-review this agent's local tool calls."
        onChange={(autoReview) => {
          onChange({ autoReview });
        }}
      />
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Workspace mode</span>
        <select
          data-testid="inspector-workspace-mode"
          className={fieldClass}
          value={data.workspaceMode ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "") {
              onChange({ workspaceMode: undefined });
              return;
            }
            const parsed = workspaceModeSchema.safeParse(value);
            if (!parsed.success) return;
            onChange({ workspaceMode: parsed.data });
          }}
        >
          <option value="">Not set</option>
          <option value="repo">repo</option>
          <option value="managed">managed</option>
          <option value="folder">folder</option>
        </select>
      </label>
      {data.workspaceMode === "folder" ? (
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>Folder</span>
          <input
            data-testid="inspector-folder-path"
            className={fieldClass}
            value={data.folderPath ?? ""}
            placeholder="Folder path"
            onChange={(event) => {
              const folderPath = event.target.value.trim();
              onChange({ folderPath: folderPath.length > 0 ? folderPath : undefined });
            }}
          />
        </label>
      ) : null}
      {data.workspaceMode === "repo" ? <WorkflowRepositoryField /> : null}
    </>
  );
}

function WorkflowRepositoryField() {
  const repositoryPath = useWorkflowStore((state) => state.workflow.repositoryPath ?? "");
  const setRepositoryPath = useWorkflowStore((state) => state.setRepositoryPath);

  return (
    <label className="block space-y-1 text-xs text-zinc-400">
      <span>Repository</span>
      <input
        data-testid="workflow-repository"
        className={fieldClass}
        value={repositoryPath}
        placeholder="Git clone for repo mode"
        onChange={(event) => {
          setRepositoryPath(event.target.value);
        }}
      />
      <span className="block text-zinc-500">Shared by every repo agent in this workflow.</span>
    </label>
  );
}

function TextFields({
  data,
  onChange,
}: {
  data: TextInputNodeData;
  onChange: (patch: InspectorPatch) => void;
}) {
  return (
    <label className="block space-y-1 text-xs text-zinc-400">
      <span>Text</span>
      <textarea
        data-testid="inspector-text"
        className={`${fieldClass} min-h-24`}
        value={data.text ?? ""}
        placeholder="The brief downstream nodes should read"
        onChange={(event) => {
          onChange({ text: event.target.value });
        }}
      />
    </label>
  );
}

function FileFields({
  data,
  onChange,
}: {
  data: FileInputNodeData;
  onChange: (patch: InspectorPatch) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500" data-testid="inspector-file-path">
        {data.sourcePath ?? "No file yet. Drop one on the card, or choose a file."}
      </p>
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>File</span>
        <input
          data-testid="inspector-file"
          className="block w-full text-xs text-zinc-300"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.item(0);
            if (!file) return;
            const sourcePath = window.swarmy.files.pathForFile(file);
            if (!sourcePath) return;
            onChange({ sourcePath });
          }}
        />
      </label>
    </div>
  );
}

function FolderFields({
  data,
  onChange,
}: {
  data: FolderInputNodeData;
  onChange: (patch: InspectorPatch) => void;
}) {
  return (
    <label className="block space-y-1 text-xs text-zinc-400">
      <span>Folder</span>
      <input
        data-testid="inspector-folder-path"
        className={fieldClass}
        value={data.folderPath ?? ""}
        placeholder="Folder path"
        onChange={(event) => {
          const folderPath = event.target.value.trim();
          onChange({ folderPath: folderPath.length > 0 ? folderPath : undefined });
        }}
      />
      <span className="block text-zinc-500">A connected agent uses this folder as its workspace.</span>
    </label>
  );
}

const emptyMcpTools: readonly string[] = [];

function McpFields({
  nodeId,
  data,
  onChange,
}: {
  nodeId: string;
  data: McpNodeData;
  onChange: (patch: InspectorPatch) => void;
}) {
  const tools = useMcpToolsStore((state) => state.byNodeId[nodeId]) ?? emptyMcpTools;
  const setTools = useMcpToolsStore((state) => state.setTools);
  const [rows, setRows] = useState<HeaderRow[]>([{ id: "header-1", name: "", value: "" }]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const secretId = data.headerSecretId;
    if (!secretId) return;
    let cancelled = false;
    void window.swarmy.mcp.readHeaders(secretId).then(
      (headers) => {
        if (cancelled) return;
        const next = Object.entries(headers).map(([name, value], index) => ({
          id: `header-${index + 1}`,
          name,
          value,
        }));
        if (next.length > 0) setRows(next);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [data.headerSecretId]);

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Transport</span>
        <select
          data-testid="inspector-mcp-transport"
          className={fieldClass}
          value={data.transport}
          onChange={(event) => {
            const parsed = mcpTransportSchema.safeParse(event.target.value);
            if (!parsed.success) return;
            onChange({ transport: parsed.data });
          }}
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
        </select>
      </label>
      {data.transport === "http" ? (
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>URL</span>
          <input
            data-testid="inspector-mcp-url"
            className={fieldClass}
            value={data.url ?? ""}
            placeholder="http://127.0.0.1:3000/mcp"
            onChange={(event) => {
              const url = event.target.value.trim();
              onChange({ url: url.length > 0 ? url : undefined });
            }}
          />
        </label>
      ) : (
        <>
          <label className="block space-y-1 text-xs text-zinc-400">
            <span>Command</span>
            <input
              data-testid="inspector-mcp-command"
              className={fieldClass}
              value={data.command ?? ""}
              placeholder="node"
              onChange={(event) => {
                const command = event.target.value.trim();
                onChange({ command: command.length > 0 ? command : undefined });
              }}
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            <span>Arguments</span>
            <textarea
              data-testid="inspector-mcp-args"
              className={`${fieldClass} min-h-16`}
              value={(data.args ?? []).join("\n")}
              placeholder="One argument per line"
              onChange={(event) => {
                onChange({ args: toolList(event.target.value) });
              }}
            />
          </label>
        </>
      )}
      <div className="space-y-2">
        <p className="text-xs text-zinc-400">Headers</p>
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-2 gap-2">
            <input
              data-testid="inspector-mcp-header-name"
              className={fieldClass}
              value={row.name}
              placeholder="Name"
              onChange={(event) => {
                setRows((current) =>
                  current.map((item) => (item.id === row.id ? { ...item, name: event.target.value } : item)),
                );
              }}
            />
            <input
              data-testid="inspector-mcp-header-value"
              className={fieldClass}
              type="password"
              value={row.value}
              placeholder="Value"
              onChange={(event) => {
                setRows((current) =>
                  current.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)),
                );
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={() => {
            setRows((current) => [...current, { id: `header-${current.length + 1}`, name: "", value: "" }]);
          }}
        >
          Add header
        </button>
        <button
          type="button"
          data-testid="inspector-mcp-save-headers"
          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={() => {
            const headers: Record<string, string> = {};
            for (const row of rows) {
              const name = row.name.trim();
              if (name.length === 0 || row.value.length === 0) continue;
              headers[name] = row.value;
            }
            if (Object.keys(headers).length === 0) {
              setStatus("Enter a header name and value.");
              return;
            }
            void window.swarmy.mcp.saveHeaders(headers, data.headerSecretId).then(
              (secretId) => {
                onChange({ headerSecretId: secretId });
                setStatus("Headers saved on this PC.");
              },
              () => {
                setStatus("Headers could not be saved.");
              },
            );
          }}
        >
          Save headers
        </button>
        <p className="text-xs text-zinc-500">Header values stay on this PC. The workflow keeps only an id.</p>
      </div>
      <button
        type="button"
        data-testid="inspector-mcp-test"
        className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        onClick={() => {
          setStatus("Testing connection…");
          void window.swarmy.mcp
            .listTools({
              transport: data.transport,
              ...(data.command ? { command: data.command } : {}),
              ...(data.args ? { args: data.args } : {}),
              ...(data.url ? { url: data.url } : {}),
              ...(data.headerSecretId ? { headerSecretId: data.headerSecretId } : {}),
            })
            .then(
              (names) => {
                setTools(nodeId, names);
                setStatus(names.length > 0 ? "Connection ok." : "The server listed no tools.");
              },
              (error: unknown) => {
                setStatus(error instanceof Error && error.message ? error.message : "The connection failed.");
              },
            );
        }}
      >
        Test connection
      </button>
      {status.length > 0 ? (
        <p className="text-xs text-zinc-300" data-testid="mcp-test-status">
          {status}
        </p>
      ) : null}
      {tools.length > 0 ? (
        <ul data-testid="mcp-inspector-tools" className="space-y-1 text-sm text-zinc-200">
          {tools.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type HeaderRow = { id: string; name: string; value: string };

function ToggleField({
  label,
  testId,
  checked,
  hint,
  onChange,
}: {
  label: string;
  testId: string;
  checked: boolean;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-zinc-400">
      <input
        data-testid={testId}
        className="mt-0.5"
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span>
        <span className="block text-zinc-300">{label}</span>
        <span className="block text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}

function ToolListField({
  label,
  modeTestId,
  listTestId,
  tools,
  onChange,
}: {
  label: string;
  modeTestId: string;
  listTestId: string;
  tools: string[] | undefined;
  onChange: (tools: string[] | undefined) => void;
}) {
  const listed = tools !== undefined;

  return (
    <div className="space-y-1">
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>{label}</span>
        <select
          data-testid={modeTestId}
          className={fieldClass}
          value={listed ? "list" : "default"}
          onChange={(event) => {
            if (event.target.value === "default") {
              onChange(undefined);
              return;
            }
            onChange(tools ?? []);
          }}
        >
          <option value="default">Default</option>
          <option value="list">Only these</option>
        </select>
      </label>
      {tools !== undefined ? (
        <textarea
          data-testid={listTestId}
          className={`${fieldClass} min-h-16`}
          value={tools.join("\n")}
          placeholder="One name per line. Empty means no tools."
          onChange={(event) => {
            onChange(toolList(event.target.value));
          }}
        />
      ) : (
        <p className="text-xs text-zinc-500">Unset uses the default toolset.</p>
      )}
    </div>
  );
}
