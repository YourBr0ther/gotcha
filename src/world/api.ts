/**
 * The contract between the world and the rest of the app. Nothing here
 * imports three. The React tree exposes a `WorldHandle` through `onReady`
 * on `<World>`; everything else in the app drives the scene through it.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "./bedrock/types";
import type { Activity } from "./bedrock/poser";
import type { DioramaId } from "./dioramas";

export type { Activity } from "./bedrock/poser";
export type { DioramaId } from "./dioramas";

export type EmoteKind = "happy" | "love" | "sad" | "angry" | "question" | "surprise" | "sleepy" | "music";

/** Everything the renderer needs for one pokemon, as plain data and URLs. */
export interface PokemonBundle {
  species: string;
  geometry: BedrockGeometryFile;
  animations: BedrockAnimationFile;
  poser: PoserFile;
  textures: {
    base: string;
    shiny?: string;
    emissive?: string;
  };
  sounds?: {
    cry?: string;
  };
  behaviour?: SpeciesBehaviour;
  /** Cobblemon's baseScale; 1 means the model is drawn at its native size. */
  baseScale?: number;
}

export interface WorldHandle {
  /** Load a pokemon. Resolves once its model and texture are on screen. */
  setPokemon(bundle: PokemonBundle, aspects?: string[]): Promise<void>;
  setDiorama(id: DioramaId): void;
  /** Play the clip the poser maps to the activity. Cancels a move in progress. */
  play(activity: Activity): void;
  /** Pop an emote bubble over the head for a moment. */
  emote(kind: EmoteKind): void;
  /** Play the cry clip and the cry sound when the bundle has one. */
  cry(): void;
  /** Walk to a named spot. Resolves true on arrival, false if interrupted or unreachable. */
  moveTo(spot: string): Promise<boolean>;
  /** Hours since midnight, fractional. Drives the light rig. */
  setTimeOfDay(hours: number): void;
}

export interface WorldState {
  bundle: PokemonBundle | null;
  aspects: string[];
  diorama: DioramaId;
  activity: Activity;
  timeOfDay: number;
  /** Increments each setPokemon so the scene can tell loads apart. */
  loadToken: number;
  /** Height of the creature on screen in blocks; the camera frames around it. */
  focusHeight: number;
}

export function localHours(now = new Date()): number {
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}
