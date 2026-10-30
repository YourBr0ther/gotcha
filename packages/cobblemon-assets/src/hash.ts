import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface FolderHash {
  /** `sha256:<hex>` over sorted relative paths and each file's sha256. */
  hash: string;
  files: number;
  bytes: number;
}

/** Deterministic hash of a folder: sorted relative paths, each with its content hash. */
export async function hashFolder(dir: string): Promise<FolderHash> {
  const paths = (await listFiles(dir)).sort();
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of paths) {
    const data = await readFile(path);
    bytes += data.length;
    hash.update(relative(dir, path).split("\\").join("/"));
    hash.update("\0");
    hash.update(sha256Hex(data));
    hash.update("\n");
  }
  return { hash: `sha256:${hash.digest("hex")}`, files: paths.length, bytes };
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
