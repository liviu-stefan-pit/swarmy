import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { PendingApproval } from "@shared/runs";
import { CollapseControl } from "./PanelChrome";
import { usePanelLayoutStore } from "./panel-layout-store";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

const DiffReview = lazy(() => import("./DiffReview").then((module) => ({ default: module.DiffReview })));

export function ApprovalInbox() {
  const approvals = useRunStore((state) => state.approvals);
  const nodes = useWorkflowStore((state) => state.workflow.nodes);
  const collapsed = usePanelLayoutStore((state) => state.inboxCollapsed);
  const toggleInbox = usePanelLayoutStore((state) => state.toggleInbox);

  return (
    <section data-testid="approval-inbox" className="border-t border-zinc-800 px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Inbox</h2>
        <CollapseControl testId="collapse-inbox" title="Inbox" collapsed={collapsed} onToggle={toggleInbox} />
      </div>
      {collapsed ? null : (
        <>
          {approvals.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">No approvals waiting.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {approvals.map((item) => {
                const label = nodes.find((node) => node.id === item.nodeId)?.data.label ?? item.nodeId;
                return <ApprovalRow key={item.nodeId} item={item} label={label} />;
              })}
            </ul>
          )}
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

function ApprovalRow({ item, label }: { item: PendingApproval; label: string }) {
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState(item.files[0]?.path ?? "");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.files.map((file) => [file.path, file.modified])),
  );
  const trimmed = reason.trim();
  const selectedFile = item.files.find((file) => file.path === selected) ?? item.files[0];

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
    <li className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
      <h3 className="text-sm font-medium text-zinc-100">{label}</h3>
      <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-300">{item.summary}</p>
      {item.workspacePath ? (
        <p className="mt-1 font-mono text-xs text-zinc-400">
          Worktree <span data-testid="diff-worktree">{item.workspacePath}</span>
        </p>
      ) : null}
      {item.files.length > 0 && selectedFile ? (
        <div className="mt-2">
          <ul className="flex flex-wrap gap-1">
            {item.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  data-testid="diff-file"
                  aria-pressed={file.path === selectedFile.path}
                  className={`rounded border px-2 py-0.5 font-mono text-xs ${
                    file.path === selectedFile.path
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
          <div data-testid="diff-editor" className="mt-2 overflow-hidden rounded border border-zinc-800">
            <DiffErrorBoundary>
              <Suspense fallback={<p className="p-2 text-sm text-zinc-400">Loading diff…</p>}>
                <DiffReview
                  key={selectedFile.path}
                  path={selectedFile.path}
                  original={selectedFile.original}
                  modified={drafts[selectedFile.path] ?? selectedFile.modified}
                  onChange={(text) => {
                    const path = selectedFile.path;
                    setDrafts((current) => ({ ...current, [path]: text }));
                  }}
                />
              </Suspense>
            </DiffErrorBoundary>
          </div>
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
    </li>
  );
}
