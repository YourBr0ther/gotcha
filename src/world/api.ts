/**
 * The contract between the world and the rest of the app. Nothing here
 * imports three. The React tree exposes a `WorldHandle` through `onReady`
 * on `<World>`; everything else in the app drives the scene through it.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { ParticleDefinitionFile } from "./bedrock/particles";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "./bedrock/types";
import type { Activity } from "./bedrock/poser";
import type { DioramaId } from "./dioramas";

export type { Activity } from "./bedrock/poser";
export type { DioramaId } from "./dioramas";
export { DIORAMA_IDS, isDioramaId } from "./dioramas";

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
    /** Glow layer (alpha eyes, cave species); drawn as emissive over the base. */
    emissive?: string;
    /** An animated glow layer (Charmander's tail flame, Slugma's lava): every frame's URL and the rate Cobblemon flips them at. `emissive` is then the first frame. */
    emissiveFrames?: { urls: string[]; fps: number };
  };
  sounds?: {
    cry?: string;
  };
  behaviour?: SpeciesBehaviour;
  /** Cobblemon's baseScale; 1 means the model is drawn at its native size. */
  baseScale?: number;
  /** The particle effects the clips fire, keyed by effect id. Absent when the species has none or the cache lacks the particle step. */
  particles?: Record<string, ParticleEffectAsset>;
}

export interface ParticleEffectAsset {
  definition: ParticleDefinitionFile;
  /** URL of the sprite sheet; absent when the jar had none, which draws a white square. */
  texture?: string;
}

export interface WorldHandle {
  /** Load a pokemon. Resolves once its model and texture are on screen. */
  setPokemon(bundle: PokemonBundle, aspects?: string[]): Promise<void>;
  /** Swap scenes behind a short fade. */
  setDiorama(id: DioramaId): void;
  /** Play the clip the poser maps to the activity. Cancels a move in progress. */
  play(activity: Activity): void;
  /** Pop an emote bubble over the head for a moment. */
  emote(kind: EmoteKind): void;
  /** Play the cry clip and the cry sound when the bundle has one. */
  cry(): void;
  /**
   * Travel to a named spot. Resolves true on arrival, false if interrupted
   * or unreachable. A species that cannot leave the water is sent to the
   * nearest water spot instead; a flier hovers over the spot.
   */
  moveTo(spot: string): Promise<boolean>;
  /** Hours since midnight, fractional. Drives the light rig. */
  setTimeOfDay(hours: number): void;
  /** Show or hide the ambient wild pokemon. Off is cheaper on a slow phone. */
  setAmbient(enabled: boolean): void;
}

export interface WorldState {
  bundle: PokemonBundle | null;
  aspects: string[];
  diorama: DioramaId;
  activity: Activity;
  timeOfDay: number;
  /** Increments each setPokemon so the scene can tell loads apart. */
  loadToken: number;
  /** The loadToken whose creature is in the scene graph, before its first frame. */
  attachedToken: number;
  /** The loadToken whose creature has its shaders compiled; the first render holds for it so the first frame draws instead of freezing. */
  compiledToken: number;
  /** The loadToken whose creature has drawn its first frame; the ambient dressing and the post chain wait for it. */
  shownToken: number;
  /** Height of the creature on screen in blocks; the camera frames around it. */
  focusHeight: number;
  /** Where the creature rests after loading (y is its body height off the ground); null means the diorama's own subject. */
  focus: { x: number; y: number; z: number } | null;
  /** True while the scene swap overlay is opaque. */
  fading: boolean;
  ambient: boolean;
  /** The painted backdrop and weather particles; off is a few frames cheaper. */
  depth: boolean;
}

export function localHours(now = new Date()): number {
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}
