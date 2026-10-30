/**
 * The games the Games screen shows. A game appears here once its manifest
 * is in `src/games/manifests.ts`; the page itself does not change. The
 * planned set still shows as "coming soon" cards until each one lands.
 */

import type { PixelIconName } from "@/components/pixel/PixelIcon";
import { MANIFESTS } from "@/games/manifests";

export interface GameManifest {
  id: string;
  title: string;
  tagline: string;
  /** Route under /games. */
  href: string;
  icon?: PixelIconName;
  /** Seconds a round takes, for the card. */
  seconds?: number;
}

export const GAMES: GameManifest[] = MANIFESTS.map((m) => ({
  id: m.id,
  title: m.name,
  tagline: m.blurb,
  href: `/games/${m.id}`,
  icon: m.icon,
  seconds: m.seconds,
}));

export const PLANNED: Omit<GameManifest, "href">[] = [
  { id: "berry-catch", title: "Berry Catch", tagline: "Catch falling berries before they bruise.", icon: "berry", seconds: 60 },
  { id: "whack-a-diglett", title: "Whack-a-Diglett", tagline: "They pop up. You tap.", icon: "stone", seconds: 45 },
  { id: "type-match", title: "Type Match", tagline: "Pairs of types, memory style.", icon: "games", seconds: 90 },
  { id: "rock-smash", title: "Rhythm Rock Smash", tagline: "Hit the beat, crack the rock.", icon: "hygiene", seconds: 60 },
  { id: "fishing", title: "Fishing", tagline: "Wait for the tug, then reel.", icon: "pokeball", seconds: 75 },
];
