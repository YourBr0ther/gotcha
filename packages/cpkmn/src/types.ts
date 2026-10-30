/**
 * TypeScript shapes for every JSON member of a .cpkmn archive.
 *
 * These mirror `schema/cpkmn.schema.json` and `docs/cpkmn-format.md`. The
 * schema is the contract; when the two disagree, fix the one that drifted and
 * bump the format version if the change is visible on disk. The sim engine,
 * the database row and the file all use these same shapes so a pokemon is one
 * object everywhere.
 */

export type IsoDate = string;
export type Uuid = string;

export interface TrainerRef {
  trainerId: Uuid;
  name: string;
}

export interface StatBlock {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export type NeedName = "hunger" | "energy" | "hygiene" | "fun" | "affection" | "health";
export type Needs = Record<NeedName, number>;
export const NEED_NAMES: readonly NeedName[] = ["hunger", "energy", "hygiene", "fun", "affection", "health"];

export type AssetMode = "embedded" | "reference";

export interface Manifest {
  format: "cpkmn";
  formatVersion: string;
  generator: { name: string; version: string };
  pokemonId: Uuid;
  createdAt: IsoDate;
  exportedAt: IsoDate;
  assetMode: AssetMode;
  assetPack?: { cobblemonVersion: string; speciesHash: string };
  contents: Record<string, { sha256: string; bytes: number }>;
  signature?: { alg: "ed25519"; keyId: string; signedAt: IsoDate; value: string };
}

export type Origin = "starter" | "egg" | "gift" | "store" | "event" | "import";
export type Gender = "male" | "female" | "genderless";

export interface Identity {
  pokemonId: Uuid;
  species: string;
  nationalDex: number;
  form: string;
  aspects: string[];
  nickname?: string;
  gender: Gender;
  shiny: boolean;
  nature: string;
  ability: string;
  hiddenAbility?: boolean;
  ballType?: string;
  originalTrainer: TrainerRef;
  currentTrainer: TrainerRef;
  hatchedAt: IsoDate;
  origin: Origin;
}

export type ExperienceGroup = "erratic" | "fast" | "medium_fast" | "medium_slow" | "slow" | "fluctuating";

export interface Move {
  id: string;
  pp: number;
  maxPp: number;
}

export interface Stats {
  level: number;
  experience: number;
  experienceGroup: ExperienceGroup;
  friendship: number;
  ivs: StatBlock;
  evs: StatBlock;
  moves: Move[];
  weightKg?: number;
  heightM?: number;
  evolution: { blocked: boolean; declinedUntil?: IsoDate | null; stage: number };
}

export type StatusCondition = "poisoned" | "burned" | "paralyzed" | "frozen";

export interface Sickness {
  kind: string;
  since: IsoDate;
  severity: 1 | 2 | 3;
}

export interface State {
  lastTickAt: IsoDate;
  needs: Needs;
  status: StatusCondition[];
  asleep: boolean;
  sleepStartedAt?: IsoDate | null;
  lastMessAt?: IsoDate | null;
  sickness?: Sickness | null;
  location: { diorama: string; spot?: string };
  activity: string;
  ageDays: number;
  careMistakes: number;
  flags?: Record<string, boolean>;
}

export interface Personality {
  traits: string[];
  temperament: string;
  likes: string[];
  dislikes: string[];
  preferences: { dioramas?: string[]; foods?: Record<string, number> };
  decayMultipliers: Needs;
  voice: { chatter?: string; quirks?: string[] };
  promptSeed: number;
}

export type EventKind =
  | "care" | "play" | "talk" | "neglect" | "milestone"
  | "trade" | "visit" | "sickness" | "evolution" | "other";

export interface EpisodicEvent {
  ts: IsoDate;
  kind: EventKind;
  summary: string;
  importance: 1 | 2 | 3 | 4 | 5;
  trainerId?: Uuid;
  emotion?: string;
}

export interface Relationship {
  bond: number;
  callsThem?: string;
  notes?: string[];
  lastSeenAt?: IsoDate;
}

export interface Memories {
  summary: string;
  episodic: EpisodicEvent[];
  relationships: Record<Uuid, Relationship>;
}

/** Cobblemon species `behaviour` block, kept loose because it varies by release. */
export interface SpeciesBehaviour {
  moving?: {
    walk?: { canWalk?: boolean; avoidsLand?: boolean; walkSpeed?: number };
    swim?: { canSwimInWater?: boolean; canBreatheUnderwater?: boolean; swimSpeed?: number; avoidsWater?: boolean };
    fly?: { canFly?: boolean; flySpeedHorizontal?: number };
    canLook?: boolean;
  };
  resting?: { canSleep?: boolean; times?: string; sleepChance?: number; light?: string; depth?: string };
  idle?: { pointAtSpawn?: boolean };
  [key: string]: unknown;
}

export interface Pokedex {
  species: string;
  nationalDex: number;
  types: string[];
  eggGroups?: string[];
  habitat?: string | null;
  generation?: number;
  flavorTexts?: string[];
  cobblemonPokedexLines?: string[];
  baseStats?: StatBlock;
  behaviour?: SpeciesBehaviour;
  evolutionChain?: Record<string, unknown>;
  spawnBiomes?: string[];
  sourcedAt: IsoDate;
}

export interface Inventory {
  heldItem: string | null;
  cosmetics: string[];
}

export type Verification = "verified" | "unverified" | "unsigned";

export interface History {
  origin: { kind: string; at: IsoDate; detail?: string };
  trainers: Array<{ trainerId: Uuid; name: string; from: IsoDate; to?: IsoDate | null }>;
  trades: Array<{ at: IsoDate; fromInstall: string; toInstall: string; verified: boolean }>;
  milestones: Array<{ at: IsoDate; kind: string; detail?: string }>;
  imports: Array<{ at: IsoDate; install: string; verification: Verification }>;
}

export interface Trade {
  nonce: string;
  fromTrainerId: Uuid;
  toTrainerId?: Uuid | null;
  offeredAt: IsoDate;
  expiresAt: IsoDate;
}

/** Binary members under assets/ when assetMode is "embedded". Keys are paths relative to assets/. */
export type AssetFiles = Record<string, Uint8Array>;

/** The whole pokemon: what pack() takes and unpack() returns. */
export interface CpkmnPokemon {
  identity: Identity;
  stats: Stats;
  state: State;
  personality: Personality;
  memories: Memories;
  pokedex: Pokedex;
  inventory: Inventory;
  history: History;
  trade?: Trade;
  assets?: AssetFiles;
  /** Unknown top-level keys from each member, preserved across round trips. */
  extra?: Partial<Record<keyof CpkmnPokemon | "manifest", Record<string, unknown>>>;
}
