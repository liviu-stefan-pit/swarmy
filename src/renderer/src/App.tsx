import { useEffect } from "react";
import { appInfo } from "@shared/app-info";

export function App() {
  const { name } = appInfo();

  useEffect(() => {
    document.title = name;
  }, [name]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 font-sans text-zinc-50">
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
    </main>
  );
}
