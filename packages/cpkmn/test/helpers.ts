/**
 * Shared fixtures for the cpkmn tests: a full synthetic pokemon, a synthetic
 * cube model (never a real Cobblemon asset), a tiny zip directory reader so
 * entry order and method are asserted independently of fflate, and a
 * rebuilder for producing tampered archives.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";
import { sha256Hex, type CpkmnPokemon, type EpisodicEvent, type Manifest } from "../src";

export const POKEMON_ID = "0192a8f4-6c3e-7d8a-b4e1-9f2c1b3a5d7e";
export const TRAINER_ELI = "0192a8f4-0000-7000-8000-000000000001";
export const TRAINER_MAE = "0192a8f4-0000-7000-8000-000000000002";
export const EXPORTED_AT = "2026-11-02T20:11:00.000Z";

export const GENERATOR = { name: "gotcha-test", version: "0.0.1" };
export const ASSET_PACK = { cobblemonVersion: "1.6.1", speciesHash: `sha256:${"ab".repeat(32)}` };

const CUBE_GEO = {
  format_version: "1.12.0",
  "minecraft:geometry": [
    {
      description: { identifier: "geometry.synthetic_cube", texture_width: 16, texture_height: 16 },
      bones: [{ name: "body", pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] }],
    },
  ],
};

export function syntheticAssets(): Record<string, Uint8Array> {
  const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
  return {
    "model.geo.json": text(CUBE_GEO),
    "animations.animation.json": text({ format_version: "1.8.0", animations: { "animation.synthetic_cube.idle": { loop: true, bones: {} } } }),
    "poser.json": text({ portraitScale: 1, poses: { standing: { poseTypes: ["STAND"], animations: ["idle"] } } }),
    "textures/base.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    "textures/shiny.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]),
    "sounds/cry.ogg": new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]),
    "sounds.json": text({ "pokemon.synthetic_cube.cry": { sounds: ["cry"] } }),
  };
}

export function syntheticEvents(count = 3): EpisodicEvent[] {
  const base: EpisodicEvent[] = [
    { ts: "2026-11-01T09:12:00Z", kind: "care", summary: "Eli fed me an oran berry while I was sulking", importance: 2, trainerId: TRAINER_ELI, emotion: "grateful" },
    { ts: "2026-11-01T21:40:00Z", kind: "milestone", summary: "Reached level 14", importance: 3 },
    { ts: "2026-11-02T08:00:00Z", kind: "play", summary: "Chased a leaf for a while", importance: 1 },
  ];
  return base.slice(0, count);
}

export function syntheticPokemon(overrides: Partial<CpkmnPokemon> = {}): CpkmnPokemon {
  return {
    identity: {
      pokemonId: POKEMON_ID,
      species: "pikachu",
      nationalDex: 25,
      form: "normal",
      aspects: ["shiny"],
      nickname: "Sparky",
      gender: "female",
      shiny: true,
      nature: "jolly",
      ability: "static",
      hiddenAbility: false,
      ballType: "poke_ball",
      originalTrainer: { trainerId: TRAINER_ELI, name: "Eli" },
      currentTrainer: { trainerId: TRAINER_ELI, name: "Eli" },
      hatchedAt: "2026-10-30T15:04:05Z",
      origin: "starter",
    },
    stats: {
      level: 14,
      experience: 3120,
      experienceGroup: "medium_fast",
      friendship: 142,
      ivs: { hp: 31, atk: 20, def: 14, spa: 30, spd: 9, spe: 31 },
      evs: { hp: 0, atk: 12, def: 0, spa: 0, spd: 0, spe: 40 },
      moves: [
        { id: "thunder_shock", pp: 30, maxPp: 30 },
        { id: "quick_attack", pp: 30, maxPp: 30 },
      ],
      weightKg: 6.2,
      heightM: 0.4,
      evolution: { blocked: false, declinedUntil: null, stage: 1 },
    },
    state: {
      lastTickAt: "2026-11-02T20:11:00Z",
      needs: { hunger: 72, energy: 40, hygiene: 88, fun: 55, affection: 90, health: 100 },
      status: [],
      asleep: false,
      sleepStartedAt: null,
      lastMessAt: "2026-11-02T14:00:00Z",
      sickness: null,
      location: { diorama: "meadow", spot: "forage_2" },
      activity: "idle",
      ageDays: 3.2,
      careMistakes: 1,
      flags: { hasEvolvedOnce: false, metAllTrainers: true },
    },
    personality: {
      traits: ["curious", "greedy", "brave"],
      temperament: "playful",
      likes: ["oran_berry", "water", "thunderstorms"],
      dislikes: ["baths", "being ignored"],
      preferences: { dioramas: ["meadow", "forest"], foods: { oran_berry: 1.5, chesto_berry: 0.6 } },
      decayMultipliers: { hunger: 1.3, energy: 0.9, hygiene: 1.0, fun: 1.2, affection: 1.1, health: 1.0 },
      voice: { chatter: "short, lots of 'pika', tilts head", quirks: ["sneezes when startled"] },
      promptSeed: 814233,
    },
    memories: {
      summary: "# Sparky\n\nA curious pikachu who likes Eli and dislikes baths. Reached level 14 last night.\n",
      episodic: syntheticEvents(),
      relationships: {
        [TRAINER_ELI]: { bond: 80, callsThem: "Eli", notes: ["feeds me berries", "stays up late"], lastSeenAt: "2026-11-02T20:00:00Z" },
        [TRAINER_MAE]: { bond: 20 },
      },
    },
    pokedex: {
      species: "pikachu",
      nationalDex: 25,
      types: ["electric"],
      eggGroups: ["field", "fairy"],
      habitat: "forest",
      generation: 1,
      flavorTexts: ["When several of these POKéMON gather, their electricity could build and cause lightning storms."],
      cobblemonPokedexLines: ["It raises its tail to check its surroundings."],
      baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
      behaviour: { moving: { walk: { canWalk: true, walkSpeed: 0.35 }, canLook: true }, resting: { canSleep: true, times: "night" } },
      evolutionChain: { from: "pichu", to: ["raichu"] },
      spawnBiomes: ["forest"],
      sourcedAt: "2026-10-30T15:00:00Z",
    },
    inventory: { heldItem: "light_ball", cosmetics: ["red_scarf"] },
    history: {
      origin: { kind: "starter", at: "2026-10-30T15:04:05Z", detail: "Chosen on the first day" },
      trainers: [{ trainerId: TRAINER_ELI, name: "Eli", from: "2026-10-30T15:04:05Z", to: null }],
      trades: [],
      milestones: [{ at: "2026-11-01T21:40:00Z", kind: "level", detail: "14" }],
      imports: [],
    },
    ...overrides,
  };
}

export function syntheticTrade() {
  return {
    nonce: "0123456789abcdef0123456789abcdef",
    fromTrainerId: TRAINER_ELI,
    toTrainerId: null,
    offeredAt: "2026-11-02T20:11:00Z",
    expiresAt: "2026-11-09T20:11:00Z",
  };
}

export interface DirEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Reads the central directory by hand so the order and method checks do not trust fflate. */
export function readCentralDirectory(bytes: Uint8Array): DirEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end of central directory");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: DirEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readManifest(bytes: Uint8Array): Manifest {
  const files = unzipSync(bytes);
  return JSON.parse(new TextDecoder().decode(files["manifest.json"])) as Manifest;
}

export interface RebuildOptions {
  /** Change members or the manifest. Return nothing. */
  mutate: (files: Record<string, Uint8Array>, manifest: Manifest) => void;
  /** Recompute contents hashes for the (possibly changed) members. Default false. */
  rehash?: boolean;
  /** Override entry order. Default: original order, new entries appended. */
  order?: string[];
  /** Override which entries are stored. Default: mimetype and assets/**. */
  stored?: (name: string) => boolean;
}

/** Unzips, lets the test change things, and zips again in the same order. */
export function rebuild(bytes: Uint8Array, options: RebuildOptions): Uint8Array {
  const original: string[] = [];
  const files = unzipSync(bytes, {
    filter: (info) => {
      original.push(info.name);
      return true;
    },
  });
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as Manifest;
  options.mutate(files, manifest);
  if (options.rehash) {
    for (const name of Object.keys(files)) {
      if (name === "mimetype" || name === "manifest.json") continue;
      manifest.contents[name] = { sha256: sha256Hex(files[name]), bytes: files[name].length };
    }
    for (const name of Object.keys(manifest.contents)) if (!(name in files)) delete manifest.contents[name];
  }
  files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
  const order = options.order ?? [...original, ...Object.keys(files).filter((n) => !original.includes(n))];
  const stored = options.stored ?? ((name: string) => name === "mimetype" || name.startsWith("assets/"));
  const zippable: Zippable = {};
  for (const name of order) {
    if (!(name in files)) continue;
    zippable[name] = [files[name], { level: stored(name) ? 0 : 6, mtime: new Date(EXPORTED_AT) }];
  }
  return zipSync(zippable);
}

export function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
}
