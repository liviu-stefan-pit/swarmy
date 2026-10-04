export type InterruptUpdate = {
  nodeId: string;
  status: string;
  log: string;
};

export type ApprovalNotification = {
  title: string;
  body: string;
  focus: "inbox";
  nodeId: string;
};

export function notificationForInterrupt(
  update: InterruptUpdate,
  notified: Set<string>,
): ApprovalNotification | null {
  if (update.status !== "waiting") {
    notified.delete(update.nodeId);
    return null;
  }
  if (notified.has(update.nodeId)) {
    return null;
  }
  notified.add(update.nodeId);
  const body = update.log.trim();
  return {
    title: "Swarmy",
    body: body.length > 0 ? body : "A run is waiting for approval.",
    focus: "inbox",
    nodeId: update.nodeId,
  };
}

export function interruptNotifications(updates: readonly InterruptUpdate[]): ApprovalNotification[] {
  const notified = new Set<string>();
  const payloads: ApprovalNotification[] = [];
  for (const update of updates) {
    const payload = notificationForInterrupt(update, notified);
    if (payload) {
      payloads.push(payload);
    }
  }
  return payloads;
}
