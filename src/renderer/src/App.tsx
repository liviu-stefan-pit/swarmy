import { useEffect, useState } from "react";
import { appInfo } from "@shared/app-info";
import type { EngineStatus } from "@shared/protocol";

function engineStatusLabel(status: EngineStatus): string {
  switch (status) {
    case "connected":
      return "Engine connected";
    case "reconnecting":
      return "Engine reconnecting";
  }
}

export function App() {
  const { name } = appInfo();
  const [status, setStatus] = useState<EngineStatus>("reconnecting");

  useEffect(() => {
    document.title = name;
  }, [name]);

  useEffect(() => {
    return window.swarmy.engine.onStatus(setStatus);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 font-sans text-zinc-50">
      <div className="flex flex-1 items-center justify-center">
        <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      </div>
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
