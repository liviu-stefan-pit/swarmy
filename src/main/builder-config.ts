import type { Configuration } from "electron-builder";

/**
 * Unsigned NSIS installer. Windows SmartScreen shows "Windows protected your PC"
 * because there is no code-signing certificate. Choose More info, then Run anyway.
 */
export const winAppManifest =
  '<longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>';

export function manifestWithLongPath(existing: string): string {
  if (/<longPathAware[^>]*>\s*true\s*<\/longPathAware>/.test(existing)) {
    return existing;
  }
  const close = existing.includes("</asmv3:windowsSettings>")
    ? "</asmv3:windowsSettings>"
    : existing.includes("</windowsSettings>")
      ? "</windowsSettings>"
      : "";
  if (!close) {
    return `${existing}${winAppManifest}`;
  }
  return existing.replace(close, `${winAppManifest}${close}`);
}

export const builderConfig: Configuration = {
  appId: "com.swarmy.app",
  productName: "Swarmy",
  asar: true,
  asarUnpack: ["**/node_modules/@cursor/sdk-win32-x64/**/*"],
  directories: {
    output: "dist",
  },
  files: ["out/**/*", "package.json", "!**/*.map"],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "${productName}-Setup-${version}.${ext}",
    shortcutName: "Swarmy",
  },
  afterPack: "scripts/embed-win-manifest.mjs",
};
