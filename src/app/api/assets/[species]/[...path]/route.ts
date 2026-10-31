/**
 * Serves one file from a species' extracted Cobblemon cache:
 * `/api/assets/<species>/<path>` -> `<cache>/<species>/<path>`. The
 * particle effects live beside the species as `particles/`, versioned by
 * their own index.
 *
 * Read-only, JSON, PNG and OGG only, and the resolved path must stay under
 * the folder the URL names. URLs carry `?v=<species hash>` (see /api/assets/index);
 * when it matches the current hash the response is immutable for a year,
 * otherwise the browser must revalidate.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cobblemonCacheDir, folderVersion, SPECIES_ID } from "../../_lib/cache";

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".ogg": "audio/ogg",
};

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(req: Request, ctx: { params: Promise<{ species: string; path: string[] }> }): Promise<Response> {
  const { species, path: parts } = await ctx.params;
  if (!SPECIES_ID.test(species) || !parts?.length) return notFound();
  const folder = path.resolve(cobblemonCacheDir(), species);
  const file = path.resolve(folder, ...parts);
  if (!file.startsWith(folder + path.sep)) return notFound();
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return notFound();

  let body: Buffer;
  try {
    const info = await stat(file);
    if (!info.isFile()) return notFound();
    body = await readFile(file);
  } catch {
    return notFound();
  }

  const version = await folderVersion(species);
  const requested = new URL(req.url).searchParams.get("v");
  const immutable = !!version && requested === version;
  const headers: Record<string, string> = {
    "content-type": type,
    "content-length": String(body.byteLength),
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
  };
  if (version) headers.etag = `"${version}"`;
  return new Response(new Uint8Array(body), { headers });
}
