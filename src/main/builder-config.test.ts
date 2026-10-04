import { expect, it } from "vitest";
import { builderConfig, winAppManifest } from "./builder-config";

it("unpacks the Cursor SDK platform package", () => {
  const unpack = builderConfig.asarUnpack;
  const patterns = (Array.isArray(unpack) ? unpack : unpack ? [unpack] : []).filter(
    (pattern): pattern is string => typeof pattern === "string",
  );
  expect(patterns.some((pattern) => pattern.includes("@cursor/sdk-win32-x64"))).toBe(true);

  expect(builderConfig.win?.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
  expect(builderConfig.mac).toBeUndefined();
  expect(builderConfig.linux).toBeUndefined();
  expect(winAppManifest).toContain("<longPathAware");
  expect(winAppManifest).toMatch(/<longPathAware[^>]*>\s*true\s*<\/longPathAware>/);
});
