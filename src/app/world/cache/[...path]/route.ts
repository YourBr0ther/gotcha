/**
 * Dev-only file server for the extracted Cobblemon cache so the world dev
 * page can load a real species. Serves `.cobblemon-cache/<species>/<file>`
 * for JSON, PNG and OGG members only.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), ".cobblemon-cache");
const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".ogg": "audio/ogg",
};

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { path: parts } = await ctx.params;
  const rel = parts.join("/");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return new Response("Not found", { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const info = await stat(file);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const body = await readFile(file);
    return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
