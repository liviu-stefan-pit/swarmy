import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { getNodeType } from "@shared/node-registry";
import type { NodeRunStatus } from "@shared/runs";
import type { HandleDataType } from "@shared/workflow";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

const handleColor: Record<HandleDataType, string> = {
  text: "#38bdf8",
  file: "#fbbf24",
  folder: "#a3e635",
  diff: "#fb7185",
  mcp: "#c4b5fd",
};

type FlowNodeData = {
  label: string;
  status?: NodeRunStatus;
  busy?: boolean;
  workflowRunning?: boolean;
};

const statusClass: Record<NodeRunStatus, string> = {
  idle: "bg-zinc-800 text-zinc-300",
  queued: "bg-zinc-800 text-zinc-200",
  running: "bg-sky-950 text-sky-200",
  waiting: "bg-amber-950 text-amber-100",
  completed: "bg-emerald-950 text-emerald-200",
  failed: "bg-red-950 text-red-200",
  cancelled: "bg-amber-950 text-amber-200",
};

function handleStyle(type: HandleDataType): CSSProperties {
  return {
    position: "relative",
    top: "auto",
    left: "auto",
    right: "auto",
    transform: "none",
    width: 12,
    height: 12,
    background: handleColor[type],
    border: "2px solid #18181b",
  };
}

export function WorkflowNodeCard({ id, type, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const definition = getNodeType(type ?? "");
  const inputs = definition?.inputs ?? [];
  const outputs = definition?.outputs ?? [];
  const status = data.status ?? "idle";
  const deleteLocked = status === "running" || data.workflowRunning === true;

  return (
    <article
      data-testid="canvas-node"
      className={`min-w-44 rounded-md border bg-zinc-900 px-3 py-2 text-zinc-50 shadow ${
        selected ? "border-sky-400" : "border-zinc-600"
      }`}
    >
      {selected ? (
        <span data-testid="selected-node" className="sr-only">
          {data.label}
        </span>
      ) : null}
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{data.label}</h3>
        <div className="flex items-center gap-2">
          {type === "agent" || type === "approval" ? (
            <span data-testid="node-status" className={`rounded-full px-2 py-0.5 text-xs ${statusClass[status]}`}>
              {status}
            </span>
          ) : null}
          <button
            type="button"
            data-testid="delete-node"
            disabled={deleteLocked}
            className="nodrag nopan rounded border border-zinc-600 px-2 py-0.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
            onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
              event.stopPropagation();
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              if (deleteLocked) return;
              useWorkflowStore.getState().removeNode(id);
            }}
          >
            Delete
          </button>
        </div>
      </header>
      {outputs.length > 0 ? (
        <div className="mt-2 space-y-1">
          {outputs.map((handle) => (
            <div key={`out-${handle.id}`} className="flex items-center justify-end gap-2 text-xs">
              <span className="text-zinc-300">{handle.label}</span>
              <span className="text-zinc-500">{handle.type}</span>
              <Handle
                id={handle.id}
                type="source"
                position={Position.Right}
                data-testid={`handle-${handle.id}-output`}
                title={`${handle.label} output (${handle.type})`}
                style={handleStyle(handle.type)}
              />
            </div>
          ))}
        </div>
      ) : null}
      {inputs.length > 0 ? (
        <div className="mt-2 space-y-1">
          {inputs.map((handle) => (
            <div key={`in-${handle.id}`} className="flex items-center gap-2 text-xs">
              <Handle
                id={handle.id}
                type="target"
                position={Position.Left}
                data-testid={`handle-${handle.id}-input`}
                title={`${handle.label} input (${handle.type})`}
                style={handleStyle(handle.type)}
              />
              <span className="text-zinc-500">{handle.type}</span>
              <span className="text-zinc-300">{handle.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {type === "agent" ? (
        <div className="nodrag nopan mt-2 flex gap-2">
          <button
            type="button"
            data-testid="run-agent"
            disabled={data.busy}
            className="rounded border border-zinc-600 px-2 py-0.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
            onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
              event.stopPropagation();
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              useWorkflowStore.getState().selectNode(id);
              void useRunStore.getState().start(id);
            }}
          >
            Run
          </button>
          <button
            type="button"
            data-testid="cancel-run"
            disabled={status !== "running"}
            className="rounded border border-zinc-600 px-2 py-0.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
            onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
              event.stopPropagation();
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              void useRunStore.getState().cancel(id);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </article>
  );
}
