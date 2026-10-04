import { BrowserWindow, Notification } from "electron";
import { notificationForInterrupt, type InterruptUpdate } from "@shared/notifications";
import { focusInboxChannel } from "@shared/triggers";

const notified = new Set<string>();

export function presentRunUpdate(update: InterruptUpdate): void {
  const payload = notificationForInterrupt(update, notified);
  if (!payload || !Notification.isSupported()) {
    return;
  }
  const body = payload.body.length > 240 ? `${payload.body.slice(0, 237)}...` : payload.body;
  const note = new Notification({ title: payload.title, body });
  note.on("click", () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
      window.webContents.send(focusInboxChannel);
    }
  });
  note.show();
}
