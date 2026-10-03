import { listenOnParentPort, readParentPort } from "./parent-port";
import { probeSqlite } from "./sqlite-spike";

const parent = readParentPort();
listenOnParentPort(parent);

try {
  const value = probeSqlite();
  parent.postMessage({ type: "sqlite.probeResult", ok: true, value });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  parent.postMessage({ type: "sqlite.probeResult", ok: false, message });
}
