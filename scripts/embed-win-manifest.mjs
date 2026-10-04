import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NtExecutable, NtExecutableResource } from "resedit";
import { manifestWithLongPath } from "../src/main/builder-config.ts";

const RT_MANIFEST = 24;

export default async function embedWinManifest(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }
  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const data = readFileSync(exePath);
  const exe = NtExecutable.from(data);
  const resources = NtExecutableResource.from(exe);
  const entry = resources.entries.find((item) => item.type === RT_MANIFEST && item.id === 1);
  if (!entry) {
    throw new Error(`No application manifest in ${exePath}`);
  }
  const current = Buffer.from(entry.bin).toString("utf8");
  const next = manifestWithLongPath(current);
  if (next === current) {
    return;
  }
  resources.replaceResourceEntryFromString(RT_MANIFEST, entry.id, entry.lang, next);
  resources.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
}
