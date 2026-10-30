/**
 * The species the asset route can serve, with the version each one's URLs
 * should carry. Small and never cached for long: it is the one request that
 * tells a client the cache changed.
 */

import { readCacheIndex, shortHash } from "../_lib/cache";

export interface AssetIndexEntry {
  v: string;
  name: string;
  dex: number;
}

export interface AssetIndex {
  cobblemonVersion?: string;
  species: Record<string, AssetIndexEntry>;
}

export async function GET(): Promise<Response> {
  const index = await readCacheIndex();
  if (!index) return Response.json({ error: "asset cache not built", code: "no_cache" }, { status: 503 });
  const species: Record<string, AssetIndexEntry> = {};
  for (const [id, entry] of Object.entries(index.species)) {
    species[id] = { v: shortHash(entry.hash), name: entry.name, dex: entry.dex };
  }
  const body: AssetIndex = { cobblemonVersion: index.cobblemonVersion, species };
  return Response.json(body, { headers: { "cache-control": "public, max-age=0, must-revalidate" } });
}
