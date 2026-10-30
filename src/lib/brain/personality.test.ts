import { describe, expect, it } from "vitest";
import { CLAMPS, NEED_NAMES, validateMember } from "@gotcha/cpkmn";
import { BERRY_IDS, createPersonality, enrichVoice, multipliersFromTraits, TRAIT_POOL } from "./personality";
import { answering, EEVEE_FACTS, SQUIRTLE_FACTS } from "./test/helpers";

describe("createPersonality", () => {
  it("is the same for the same seed and different for another", () => {
    const a = createPersonality(EEVEE_FACTS, 814233);
    const b = createPersonality(EEVEE_FACTS, 814233);
    expect(b).toEqual(a);
    const seeds = Array.from({ length: 20 }, (_, i) => createPersonality(EEVEE_FACTS, i * 7919 + 1));
    expect(new Set(seeds.map((p) => p.traits.join(","))).size).toBeGreaterThan(5);
  });

  it("keeps multipliers inside the file's range and health at one", () => {
    for (let seed = 1; seed < 400; seed += 13) {
      const p = createPersonality(seed % 2 === 0 ? EEVEE_FACTS : SQUIRTLE_FACTS, seed);
      for (const need of NEED_NAMES) {
        expect(p.decayMultipliers[need]).toBeGreaterThanOrEqual(CLAMPS.decayMultiplier.min);
        expect(p.decayMultipliers[need]).toBeLessThanOrEqual(CLAMPS.decayMultiplier.max);
      }
      expect(p.decayMultipliers.health).toBe(1);
    }
    const heavy = multipliersFromTraits(["greedy", "playful", "clingy", "fussy", "mischievous", "curious"]);
    expect(heavy.fun).toBeLessThanOrEqual(CLAMPS.decayMultiplier.max);
  });

  it("has two to four distinct traits, a temperament, likes, dislikes and berry preferences", () => {
    const p = createPersonality(SQUIRTLE_FACTS, 42);
    expect(p.traits.length).toBeGreaterThanOrEqual(2);
    expect(p.traits.length).toBeLessThanOrEqual(4);
    expect(new Set(p.traits).size).toBe(p.traits.length);
    expect(p.traits.every((t) => (TRAIT_POOL as readonly string[]).includes(t))).toBe(true);
    expect(["playful", "calm", "bold", "timid", "grumpy"]).toContain(p.temperament);
    expect(p.likes.length).toBeGreaterThan(0);
    expect(p.dislikes.length).toBeGreaterThan(0);
    const foods = Object.keys(p.preferences.foods ?? {});
    expect(foods.length).toBe(3);
    expect(foods.every((id) => (BERRY_IDS as readonly string[]).includes(id))).toBe(true);
    for (const w of Object.values(p.preferences.foods ?? {})) {
      expect(w).toBeGreaterThanOrEqual(0.5);
      expect(w).toBeLessThanOrEqual(1.7);
    }
    expect(p.voice.chatter).toContain("squir");
    expect(p.voice.quirks).toHaveLength(1);
    expect(p.promptSeed).toBe(42);
  });

  it("validates against the cpkmn personality schema", () => {
    for (const seed of [1, 99, 123456, 2 ** 31 - 1]) {
      expect(validateMember("personality", createPersonality(EEVEE_FACTS, seed))).toEqual([]);
    }
  });

  it("leaves the voice alone with no key, and lets a model rewrite chatter and add one quirk", async () => {
    const base = createPersonality(EEVEE_FACTS, 7);
    expect(await enrichVoice(base, EEVEE_FACTS, { configured: false })).toBe(base);
    const generate = answering({ chatter: "chirpy, trails off into a yawn", quirk: "sits on your shoes" });
    const rich = await enrichVoice(base, EEVEE_FACTS, { configured: true, generate, model: "fake-model" });
    expect(rich.voice.chatter).toBe("chirpy, trails off into a yawn");
    expect(rich.voice.quirks?.[0]).toBe("sits on your shoes");
    expect(rich.decayMultipliers).toEqual(base.decayMultipliers);
    const broken = await enrichVoice(base, EEVEE_FACTS, { configured: true, generate: answering({ nope: 1 }), model: "fake-model" });
    expect(broken).toBe(base);
  });
});
