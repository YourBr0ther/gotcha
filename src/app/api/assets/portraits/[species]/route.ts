/**
 * A species' portrait, made by `scripts/portraits.py` from the render
 * audit's idle frame and kept next to the pokedex cache. Missing is a
 * plain 404: every list that shows one has a fallback.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pokedexCacheDir } from "@/lib/services/pokedex";
import { SPECIES_ID } from "../../_lib/cache";

export async function GET(_request: Request, { params }: { params: Promise<{ species: string }> }): Promise<Response> {
  const { species } = await params;
  if (!SPECIES_ID.test(species)) return new Response("bad species", { status: 400 });
  let body: Buffer;
  try {
    body = await readFile(path.join(pokedexCacheDir(), "portraits", `${species}.webp`));
  } catch {
    return new Response("no portrait", { status: 404 });
  }
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=86400" },
  });
}
