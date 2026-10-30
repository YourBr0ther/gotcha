import type { GameManifestData } from "../types";
import { ROUND_MS } from "./rules";

export const manifest: GameManifestData = {
  id: "whack-a-diglett",
  name: "Whack-a-Diglett",
  icon: "stone",
  blurb: "They pop up. You tap.",
  minimumLevel: 1,
  // A round always runs the full clock; a paused tab can stretch it.
  durationMs: { min: ROUND_MS - 1_000, max: ROUND_MS + 30_000 },
  seconds: ROUND_MS / 1000,
};
