/**
 * The species the asset route can serve, with the version each one's URLs
 * should carry. Small and never cached for long: it is the one request that
 * tells a client the cache changed.
 */

import { readCacheIndex, readParticleIndex, shortHash } from "../_lib/cache";

export interface AssetIndexEntry {
  v: string;
  name: string;
  dex: number;
}

export interface AssetIndex {
  cobblemonVersion?: string;
  species: Record<string, AssetIndexEntry>;
  /** Present once the particle step has run on the cache; its version covers `/api/assets/particles/*`. */
  particles?: { v: string };
}

export async function GET(): Promise<Response> {
  const index = await readCacheIndex();
  if (!index) return Response.json({ error: "asset cache not built", code: "no_cache" }, { status: 503 });
  const species: Record<string, AssetIndexEntry> = {};
  for (const [id, entry] of Object.entries(index.species)) {
    species[id] = { v: shortHash(entry.hash), name: entry.name, dex: entry.dex };
  }
  const body: AssetIndex = { cobblemonVersion: index.cobblemonVersion, species };
  const particles = await readParticleIndex();
  if (particles) body.particles = { v: shortHash(particles.hash) };
  return Response.json(body, { headers: { "cache-control": "public, max-age=0, must-revalidate" } });
}
