import type { CpkmnPokemon } from "./types";

export const FORMAT_VERSION = "1.0.0";
export const MIMETYPE = "application/vnd.gotcha.cpkmn";
export const MIMETYPE_ENTRY = "mimetype";
export const MANIFEST_ENTRY = "manifest.json";
export const ASSETS_PREFIX = "assets/";

/** Limits the spec states in prose. */
export const SUMMARY_MAX_CHARS = 2000;
export const EPISODIC_KEEP_LINES = 500;
export const EPISODIC_KEEP_IMPORTANCE = 3;

export const CLAMPS = {
  decayMultiplier: { min: 0.5, max: 1.5 },
  friendship: { min: 0, max: 255 },
  need: { min: 0, max: 100 },
} as const;

/** JSON members keyed by the CpkmnPokemon field they populate, in archive order. */
export const JSON_MEMBERS = {
  identity: "identity.json",
  stats: "stats.json",
  state: "state.json",
  personality: "personality.json",
  pokedex: "pokedex.json",
  inventory: "inventory.json",
  history: "history.json",
  trade: "trade.json",
} as const satisfies Partial<Record<keyof CpkmnPokemon, string>>;

export type JsonMemberKey = keyof typeof JSON_MEMBERS;

export const SUMMARY_ENTRY = "memories/summary.md";
export const EPISODIC_ENTRY = "memories/episodic.jsonl";
export const RELATIONSHIPS_ENTRY = "memories/relationships.json";

/** Entry order after mimetype and manifest.json. Assets follow, sorted by path. */
export const MEMBER_ORDER: readonly string[] = [
  JSON_MEMBERS.identity,
  JSON_MEMBERS.stats,
  JSON_MEMBERS.state,
  JSON_MEMBERS.personality,
  SUMMARY_ENTRY,
  EPISODIC_ENTRY,
  RELATIONSHIPS_ENTRY,
  JSON_MEMBERS.pokedex,
  JSON_MEMBERS.inventory,
  JSON_MEMBERS.history,
  JSON_MEMBERS.trade,
];

/** Members every file must carry. trade.json and assets/** are conditional. */
export const REQUIRED_MEMBERS: readonly string[] = MEMBER_ORDER.filter((m) => m !== JSON_MEMBERS.trade);

/** Asset paths (relative to assets/) an embedded file is expected to carry. */
export const REQUIRED_ASSETS: readonly string[] = [
  "model.geo.json",
  "animations.animation.json",
  "poser.json",
  "textures/base.png",
  "sounds/cry.ogg",
  "sounds.json",
];
