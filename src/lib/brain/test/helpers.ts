/**
 * Test support for the brain: a context with no database, a fake generate
 * that answers from a fixture, and a mock SDK model that answers the same
 * way through generateObject itself.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import type { Personality, State } from "@gotcha/cpkmn";
import { freshState, mood, neutralPersonality, neutralSpecies } from "@/lib/sim";
import type { GenerateFn } from "../generate";
import { buildMenu, localTime } from "../menu";
import type { BrainSpeciesFacts, TickContext } from "../types";

export const NOON = "2026-11-02T12:00:00.000Z";
export const MIDNIGHT = "2026-11-02T23:30:00.000Z";

export const EEVEE_FACTS: BrainSpeciesFacts = {
  species: "eevee",
  name: "Eevee",
  types: ["normal"],
  habitat: "urban",
  flavorTexts: ["Its genetic code is irregular. It may mutate if it is exposed to radiation from element stones."],
  pokedexLines: ["Thanks to its unstable genetic makeup, this special Pokemon conceals many different possible evolutions."],
  behaviour: { moving: { swim: { avoidsWater: true } }, resting: { canSleep: true } },
};

export const SQUIRTLE_FACTS: BrainSpeciesFacts = {
  species: "squirtle",
  name: "Squirtle",
  types: ["water"],
  behaviour: { moving: { swim: { canSwimInWater: true, canBreatheUnderwater: true } } },
};

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as T;
}

export interface ContextOptions {
  now?: string;
  state?: Partial<State>;
  needs?: Partial<State["needs"]>;
  personality?: Partial<Personality>;
  facts?: BrainSpeciesFacts;
  utcOffsetMinutes?: number;
  summary?: string;
}

export function fakeContext(options: ContextOptions = {}): TickContext {
  const now = options.now ?? NOON;
  const state: State = { ...freshState(now, options.needs), ...options.state };
  const personality: Personality = { ...neutralPersonality(), traits: ["curious", "playful"], promptSeed: 814233, voice: { chatter: "short vee-vee cries", quirks: ["tilts head"] }, ...options.personality };
  const facts = options.facts ?? EEVEE_FACTS;
  const offset = options.utcOffsetMinutes ?? 0;
  const m = mood(state, neutralSpecies(facts.species), now, { utcOffsetMinutes: offset });
  const local = localTime(now, offset);
  return {
    pokemonId: "00000000-0000-4000-8000-000000000001",
    name: "Vee",
    facts,
    personality,
    state,
    mood: m,
    now,
    local,
    summary: options.summary ?? "",
    recentEvents: [{ ts: now, kind: "care", summary: "Eli fed Vee", importance: 1, trainerId: "00000000-0000-4000-8000-0000000000aa", emotion: "content" }],
    trainer: { id: "00000000-0000-4000-8000-0000000000aa", name: "Eli" },
    relationship: null,
    menu: buildMenu(state, m, facts, local),
  };
}

/** A generate function that answers with a fixed object and a token count. */
export function answering(object: unknown, tokens = 20): GenerateFn & { calls: number } {
  const fn = Object.assign(
    async () => {
      fn.calls += 1;
      return { object, tokens };
    },
    { calls: 0 },
  );
  return fn;
}

/** A generate function that never answers unless the signal aborts it. */
export function hanging(): GenerateFn {
  return ({ signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
}

/** A real SDK model object that answers generateObject with the given JSON text. */
export function mockModel(object: unknown, modelId = "zai-org/glm-5.2"): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId,
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(object) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}
