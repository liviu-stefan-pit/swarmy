import { copyFile, mkdir, open } from "node:fs/promises";
import { basename, join } from "node:path";

export const fileExcerptMaxBytes = 20 * 1024;

export async function stageDroppedFile(
  sourcePath: string,
  inputDir: string,
  nodeId: string,
): Promise<{ path: string; excerpt: string }> {
  const directory = join(inputDir, nodeId);
  await mkdir(directory, { recursive: true });
  const dest = join(directory, basename(sourcePath));
  await copyFile(sourcePath, dest);
  const file = await open(dest, "r");
  try {
    const buffer = Buffer.alloc(fileExcerptMaxBytes);
    const { bytesRead } = await file.read(buffer, 0, fileExcerptMaxBytes, 0);
    return { path: dest, excerpt: buffer.subarray(0, bytesRead).toString("utf8") };
  } finally {
    await file.close();
  }
}
