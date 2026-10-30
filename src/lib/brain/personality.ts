/**
 * Personality at hatch. Rules pick everything from seeded pools biased by
 * the species' types, so the same seed gives the same pokemon on every
 * install with no key. When a model is configured it rewrites the voice
 * (chatter and one quirk) afterwards; everything the engine reads
 * (decayMultipliers, preferences) stays rules-made.
 */

import type { LanguageModel } from "ai";
import { z } from "zod";
import { CLAMPS, NEED_NAMES, type Needs, type Personality } from "@gotcha/cpkmn";
import { STORE_ITEMS, type Temperament } from "@/lib/sim";
import { BRAIN_TIMEOUT_MS } from "./constants";
import { generateWithSdk, type GenerateFn } from "./generate";
import { speciesBlock } from "./prompts";
import { isConfigured, talkModel } from "./provider";
import { mulberry32, pick, pickMany } from "./random";
import type { BrainSpeciesFacts } from "./types";

export const TRAIT_POOL = [
  "curious", "playful", "gentle", "brave", "shy", "greedy", "stubborn", "cheerful",
  "lazy", "mischievous", "proud", "clingy", "fussy", "calm", "dreamy", "bold", "timid", "loyal",
] as const;
export type Trait = (typeof TRAIT_POOL)[number];

const TEMPERAMENTS: readonly Temperament[] = ["playful", "calm", "bold", "timid", "grumpy"];

/** Traits each type leans toward. One of these is always in the mix when the type matches. */
const TYPE_TRAITS: Readonly<Record<string, readonly Trait[]>> = {
  fire: ["brave", "proud", "bold"],
  water: ["calm", "playful", "gentle"],
  grass: ["gentle", "lazy", "dreamy"],
  electric: ["playful", "mischievous", "curious"],
  normal: ["curious", "cheerful", "loyal"],
  psychic: ["curious", "dreamy", "proud"],
  dark: ["mischievous", "stubborn", "shy"],
  fairy: ["clingy", "cheerful", "fussy"],
  fighting: ["brave", "stubborn", "proud"],
  ghost: ["shy", "mischievous", "dreamy"],
  ice: ["calm", "timid", "fussy"],
  rock: ["stubborn", "calm", "lazy"],
  ground: ["calm", "lazy", "stubborn"],
  flying: ["curious", "playful", "timid"],
  bug: ["timid", "curious", "greedy"],
  poison: ["mischievous", "greedy", "stubborn"],
  dragon: ["proud", "brave", "bold"],
  steel: ["loyal", "calm", "proud"],
};

const TYPE_TEMPERAMENT: Readonly<Record<string, readonly Temperament[]>> = {
  fire: ["bold", "playful"],
  water: ["calm", "playful"],
  grass: ["calm"],
  electric: ["playful", "bold"],
  dark: ["grumpy", "timid"],
  ghost: ["timid", "grumpy"],
  rock: ["grumpy", "calm"],
  fairy: ["playful"],
  bug: ["timid"],
  flying: ["playful"],
  dragon: ["bold"],
};

const LIKE_POOL = ["sunny mornings", "being petted", "berries", "naps in the grass", "chasing things", "music", "the pond", "being carried", "rain on the roof", "new toys", "attention", "quiet evenings"] as const;
const DISLIKE_POOL = ["baths", "being ignored", "loud noises", "being woken up", "waiting for food", "cold mornings", "being scolded", "getting dirty", "thunder", "strangers"] as const;
const TYPE_LIKES: Readonly<Record<string, readonly string[]>> = {
  water: ["swimming", "rain", "the pond"],
  fire: ["warm rocks", "sunshine"],
  grass: ["sunshine", "flowers"],
  electric: ["thunderstorms", "running"],
  dark: ["night time", "hiding"],
  ghost: ["night time", "the dark"],
  ice: ["cold mornings", "snow"],
  flying: ["wind", "high places"],
};
const TYPE_DISLIKES: Readonly<Record<string, readonly string[]>> = {
  fire: ["rain", "baths"],
  water: ["dry heat"],
  grass: ["the dark"],
  ice: ["warm afternoons"],
  ghost: ["bright mornings"],
  rock: ["swimming"],
};

const QUIRK_POOL = [
  "sneezes when startled",
  "tilts its head before answering",
  "hums while eating",
  "sleeps curled in a tight ball",
  "stares at its reflection in the water",
  "stamps a foot when impatient",
  "collects pebbles",
  "yawns with its whole body",
  "chirps twice when pleased",
  "hides behind things and peeks out",
  "flicks its tail when thinking",
  "falls asleep mid-play",
] as const;

/** How traits pull on decay. Multiplied together then clamped to the file range. */
const TRAIT_DECAY: Readonly<Partial<Record<Trait, Partial<Needs>>>> = {
  greedy: { hunger: 1.25 },
  lazy: { energy: 0.85, fun: 0.9 },
  playful: { fun: 1.2, energy: 1.1 },
  clingy: { affection: 1.3 },
  loyal: { affection: 1.1 },
  fussy: { hygiene: 1.2 },
  calm: { fun: 0.9, affection: 0.95 },
  dreamy: { energy: 1.1 },
  curious: { fun: 1.1 },
  stubborn: { affection: 0.9 },
  shy: { affection: 1.1, fun: 0.9 },
  timid: { energy: 1.05 },
  mischievous: { hygiene: 1.15, fun: 1.1 },
  bold: { hunger: 1.1 },
  brave: { energy: 1.05 },
  gentle: { hygiene: 0.9 },
  cheerful: { fun: 0.9 },
  proud: { hygiene: 0.9 },
};

export const BERRY_IDS = (Object.keys(STORE_ITEMS) as Array<keyof typeof STORE_ITEMS>).filter((id) => STORE_ITEMS[id].category === "berry");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function multipliersFromTraits(traits: readonly string[]): Needs {
  const out = {} as Needs;
  for (const need of NEED_NAMES) {
    let value = 1;
    for (const trait of traits) value *= TRAIT_DECAY[trait as Trait]?.[need] ?? 1;
    out[need] = round2(Math.max(CLAMPS.decayMultiplier.min, Math.min(CLAMPS.decayMultiplier.max, value)));
  }
  out.health = 1;
  return out;
}

/** A cry syllable from the species name, for the default chatter. */
function crySyllable(species: string): string {
  const clean = species.replace(/[^a-z]/gi, "").toLowerCase();
  const m = /^[^aeiou]*[aeiou]+[^aeiou]?/.exec(clean);
  return m ? m[0] : clean.slice(0, 3);
}

export function createPersonality(facts: BrainSpeciesFacts, seed: number): Personality {
  const promptSeed = Math.abs(Math.floor(seed)) % 2 ** 31;
  const rand = mulberry32(promptSeed);
  const types = facts.types.map((t) => t.toLowerCase());

  const traitCount = 2 + Math.floor(rand() * 3); // 2..4
  const typeTrait = pick(rand, TYPE_TRAITS[types[0]] ?? TYPE_TRAITS.normal);
  const traits = [typeTrait, ...pickMany(rand, TRAIT_POOL.filter((t) => t !== typeTrait), traitCount - 1)];

  const temperamentPool = types.flatMap((t) => TYPE_TEMPERAMENT[t] ?? []);
  const temperament = rand() < 0.6 && temperamentPool.length > 0 ? pick(rand, temperamentPool) : pick(rand, TEMPERAMENTS);

  const likes = [...pickMany(rand, types.flatMap((t) => TYPE_LIKES[t] ?? []), 1), ...pickMany(rand, LIKE_POOL, 2)];
  const dislikes = [...pickMany(rand, types.flatMap((t) => TYPE_DISLIKES[t] ?? []), 1), ...pickMany(rand, DISLIKE_POOL, 2)];

  const foods: Record<string, number> = {};
  const [fav, second, hated] = pickMany(rand, BERRY_IDS, 3);
  if (fav) foods[fav] = round2(1.3 + rand() * 0.4);
  if (second) foods[second] = round2(1.1 + rand() * 0.2);
  if (hated) foods[hated] = round2(0.5 + rand() * 0.3);

  const syllable = crySyllable(facts.species);
  const chatter = `${temperament} ${syllable}-${syllable} cries, ${traits[0]} and ${traits[1]}`;
  const quirks = pickMany(rand, QUIRK_POOL, 1);

  return {
    traits,
    temperament,
    likes: [...new Set(likes)],
    dislikes: [...new Set(dislikes)],
    preferences: { foods },
    decayMultipliers: multipliersFromTraits(traits),
    voice: { chatter, quirks },
    promptSeed,
  };
}

export const VoiceOutput = z.object({
  chatter: z.string().min(1).max(200),
  quirk: z.string().min(1).max(80),
});

export interface VoiceDeps {
  generate?: GenerateFn;
  model?: LanguageModel;
  configured?: boolean;
  timeoutMs?: number;
}

/**
 * Lets the model write the chatter and one quirk. Not budgeted: it runs
 * once per hatch and the row does not exist yet. Any failure keeps the
 * rules-made voice.
 */
export async function enrichVoice(personality: Personality, facts: BrainSpeciesFacts, deps: VoiceDeps = {}): Promise<Personality> {
  if (!(deps.configured ?? isConfigured())) return personality;
  const generate = deps.generate ?? generateWithSdk;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? BRAIN_TIMEOUT_MS);
  try {
    const model = deps.model ?? talkModel();
    const system = "You write the voice of a pokemon for a small virtual pet game. Pokemon speak in cries; describe how this one's cries and body language come across, in one sentence, and give one physical quirk. Answer with one JSON object.";
    const prompt = [
      `<species_facts>\n${speciesBlock(facts)}\n</species_facts>`,
      `<personality>\ntraits: ${personality.traits.join(", ")}\ntemperament: ${personality.temperament}\nlikes: ${personality.likes.join(", ")}\ndislikes: ${personality.dislikes.join(", ")}\n</personality>`,
      '<output_schema>\n{ "chatter": one sentence under 200 characters, "quirk": one short physical habit under 80 characters }\n</output_schema>',
    ].join("\n\n");
    const result = await generate({ model, system, prompt, schema: VoiceOutput, signal });
    const parsed = VoiceOutput.safeParse(result.object);
    if (!parsed.success) return personality;
    const quirks = [parsed.data.quirk.trim(), ...(personality.voice.quirks ?? [])].slice(0, 3);
    return { ...personality, voice: { chatter: parsed.data.chatter.trim(), quirks } };
  } catch (error) {
    console.warn("personality voice fell back to rules", error);
    return personality;
  }
}
