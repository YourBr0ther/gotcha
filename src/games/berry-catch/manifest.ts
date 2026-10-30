import type { GameManifestData } from "../types";
import { ROUND_MS } from "./rules";

export const manifest: GameManifestData = {
  id: "berry-catch",
  name: "Berry Catch",
  icon: "berry",
  blurb: "Catch falling berries before they bruise.",
  minimumLevel: 1,
  // Three early misses can end a round in a few seconds; a paused tab can stretch one well past the minute.
  durationMs: { min: 2_000, max: ROUND_MS + 30_000 },
  seconds: ROUND_MS / 1000,
};
