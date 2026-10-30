/**
 * The contract between a game module and the rest of the app. A game is a
 * folder under src/games with a manifest (data only, safe on the server),
 * pure rules, and a client Game component that hands back one
 * GameRoundResult. Games never touch Bytes; the games service turns the
 * result into a payout through the engine's miniGamePayout.
 */

import type { PixelIconName } from "@/components/pixel/PixelIcon";

export interface GameManifestData {
  id: string;
  name: string;
  icon: PixelIconName;
  blurb: string;
  /** The active pokemon must be at least this level to play. 1 means anyone. */
  minimumLevel: number;
  /** Wall-clock bounds the server accepts for a round's durationMs. */
  durationMs: { min: number; max: number };
  /** Nominal round length for the card. */
  seconds: number;
}

/** What a Game component reports when a round ends. The server divides score by maxScore. */
export interface GameRoundResult {
  gameId: string;
  score: number;
  maxScore: number;
  durationMs: number;
  perfect: boolean;
}

export interface GameProps {
  onFinish: (result: GameRoundResult) => void;
  /** False during the countdown: the board shows but the clock does not run. Defaults to true. */
  active?: boolean;
  /** Plays itself so the playtester can screenshot a round. */
  demo?: boolean;
  /** Fixes the random sequence so demo rounds repeat. */
  seed?: number;
}
