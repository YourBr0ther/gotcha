import type { GameManifestData } from "../types";
import { TIME_LIMIT_MS } from "./rules";

export const manifest: GameManifestData = {
  id: "type-match",
  name: "Type Match",
  icon: "games",
  blurb: "Pairs of types, memory style.",
  minimumLevel: 1,
  // Eight pairs need at least eight moves; a paused tab can stretch a round.
  durationMs: { min: 4_000, max: TIME_LIMIT_MS + 30_000 },
  seconds: TIME_LIMIT_MS / 1000,
};
