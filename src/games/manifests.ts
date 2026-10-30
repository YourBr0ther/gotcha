/**
 * Every game's manifest, data only, so the server (the games service, the
 * Games page) can read ids, names and duration bounds without pulling in a
 * Game component. The client map of components lives in ./index.ts.
 */

import type { GameManifestData } from "./types";
import { manifest as berryCatch } from "./berry-catch/manifest";
import { manifest as whackADiglett } from "./whack-a-diglett/manifest";
import { manifest as typeMatch } from "./type-match/manifest";

export const MANIFESTS: readonly GameManifestData[] = [berryCatch, whackADiglett, typeMatch];

export function findManifest(id: string): GameManifestData | undefined {
  return MANIFESTS.find((m) => m.id === id);
}

export type { GameManifestData } from "./types";
