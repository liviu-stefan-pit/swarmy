import { useState } from "react";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

export function ApprovalInbox() {
  const approvals = useRunStore((state) => state.approvals);
  const nodes = useWorkflowStore((state) => state.workflow.nodes);

  return (
    <section data-testid="approval-inbox" className="border-t border-zinc-800 px-4 py-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Inbox</h2>
      {approvals.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-500">No approvals waiting.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {approvals.map((item) => {
            const label = nodes.find((node) => node.id === item.nodeId)?.data.label ?? item.nodeId;
            return <ApprovalRow key={item.nodeId} nodeId={item.nodeId} label={label} summary={item.summary} />;
          })}
        </ul>
      )}
    </section>
  );
}

function ApprovalRow({ nodeId, label, summary }: { nodeId: string; label: string; summary: string }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();

  async function send(action: "approve" | "reject"): Promise<void> {
    if (action === "reject" && trimmed.length === 0) {
      return;
    }
    setBusy(true);
    try {
      await useRunStore.getState().decide({
        nodeId,
        action,
        ...(action === "reject" ? { reason: trimmed } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
      <h3 className="text-sm font-medium text-zinc-100">{label}</h3>
      <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-300">{summary}</p>
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
