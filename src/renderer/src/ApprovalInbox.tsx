import { Component, lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PendingApproval } from "@shared/runs";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

const DiffReview = lazy(() => import("./DiffReview").then((module) => ({ default: module.DiffReview })));

const minDiffHeight = 160;

export function ApprovalInbox({ height }: { height?: number }) {
  const approvals = useRunStore((state) => state.approvals);
  const nodes = useWorkflowStore((state) => state.workflow.nodes);
  const [pickedId, setPickedId] = useState(approvals[0]?.nodeId ?? "");
  const activeId = approvals.some((item) => item.nodeId === pickedId) ? pickedId : (approvals[0]?.nodeId ?? "");

  return (
    <section data-testid="approval-inbox" className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-2">
      {approvals.length === 0 ? (
        <p className="text-sm text-zinc-500">No approvals waiting.</p>
      ) : (
        <>
          {approvals.length > 1 ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {approvals.map((item) => {
                const label = nodes.find((node) => node.id === item.nodeId)?.data.label ?? item.nodeId;
                const selected = item.nodeId === activeId;
                return (
                  <button
                    key={item.nodeId}
                    type="button"
                    data-testid="approval-pick"
                    aria-pressed={selected}
                    className={`rounded border px-2 py-0.5 text-xs ${
                      selected ? "border-sky-700 bg-sky-950 text-zinc-50" : "border-zinc-700 text-zinc-300"
                    }`}
                    onClick={() => {
                      setPickedId(item.nodeId);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {approvals.map((item) => {
            const label = nodes.find((node) => node.id === item.nodeId)?.data.label ?? item.nodeId;
            return (
              <div
                key={item.nodeId}
                hidden={item.nodeId !== activeId}
                className="flex min-h-0 flex-1 flex-col"
              >
                <ApprovalRow item={item} label={label} height={height} visible={item.nodeId === activeId} />
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

class DiffErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p data-testid="diff-error" className="p-2 text-sm text-red-300">
          Diff failed to load.
        </p>
      );
    }
    return this.props.children;
  }
}

function ApprovalRow({
  item,
  label,
  height,
  visible,
}: {
  item: PendingApproval;
  label: string;
  height?: number;
  visible: boolean;
}) {
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState(item.files[0]?.path ?? "");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.files.map((file) => [file.path, file.modified])),
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const appliedHeight = useRef(0);
  const [fitted, setFitted] = useState<number | undefined>();
  const trimmed = reason.trim();
  const selectedFile = item.files.find((file) => file.path === selected) ?? item.files[0];
  const fallbackHeight = height === undefined ? undefined : Math.max(minDiffHeight, height);
  const editorHeight = fitted ?? fallbackHeight;

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    const node = editorRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const box = node.clientHeight;
      if (box === 0) {
        return;
      }
      const next = Math.max(minDiffHeight, box);
      if (Math.abs(next - appliedHeight.current) < 4) {
        return;
      }
      appliedHeight.current = next;
      setFitted(next);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [fallbackHeight, item.summary, selected, visible]);

  async function send(action: "approve" | "reject"): Promise<void> {
    if (action === "reject" && trimmed.length === 0) {
      return;
    }
    setBusy(true);
    try {
      await useRunStore.getState().decide({
        nodeId: item.nodeId,
        action,
        ...(action === "reject" ? { reason: trimmed } : {}),
        ...(action === "approve" && item.files.length > 0
          ? {
              files: item.files.map((file) => ({
                path: file.path,
                text: drafts[file.path] ?? file.modified,
              })),
            }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">{label}</h3>
        <p className="mt-1 max-h-24 overflow-auto text-sm whitespace-pre-wrap text-zinc-300">{item.summary}</p>
        {item.workspacePath ? (
          <p className="mt-1 font-mono text-xs text-zinc-400">
            Worktree <span data-testid="diff-worktree">{item.workspacePath}</span>
          </p>
        ) : null}
        {item.files.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1">
            {item.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  data-testid="diff-file"
                  aria-pressed={file.path === selectedFile?.path}
                  className={`rounded border px-2 py-0.5 font-mono text-xs ${
                    file.path === selectedFile?.path
                      ? "border-red-800 bg-red-950 text-zinc-100"
                      : "border-zinc-700 text-zinc-300"
                  }`}
                  onClick={() => {
                    setSelected(file.path);
                  }}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {item.files.length > 0 && selectedFile ? (
        <div
          ref={editorRef}
          data-testid="diff-editor"
          className="mt-2 min-h-0 flex-1 overflow-hidden rounded border border-zinc-800"
        >
          <DiffErrorBoundary>
            <Suspense fallback={<p className="p-2 text-sm text-zinc-400">Loading diff…</p>}>
              <DiffReview
                key={selectedFile.path}
                path={selectedFile.path}
                original={selectedFile.original}
                modified={drafts[selectedFile.path] ?? selectedFile.modified}
                height={editorHeight}
                onChange={(text) => {
                  const path = selectedFile.path;
                  setDrafts((current) => ({ ...current, [path]: text }));
                }}
              />
            </Suspense>
          </DiffErrorBoundary>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="approval-approve"
          disabled={busy}
          className="rounded border border-emerald-700 px-3 py-1 text-sm hover:bg-emerald-950 disabled:opacity-50"
          onClick={() => {
            void send("approve");
          }}
        >
          Approve
        </button>
        <input
          data-testid="approval-reject-reason"
          value={reason}
          aria-label={`Reject ${label}`}
          placeholder="Reason for rejecting"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-50"
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <button
          type="button"
          data-testid="approval-reject"
          disabled={busy || trimmed.length === 0}
          className="rounded border border-red-800 px-3 py-1 text-sm hover:bg-red-950 disabled:opacity-50"
          onClick={() => {
            void send("reject");
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
