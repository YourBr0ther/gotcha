/**
 * The games the Games screen shows. A game appears here once its manifest
 * is in `src/games/manifests.ts`; the page itself does not change. Games
 * still to build are listed in docs/roadmap.md, not on the screen.
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
