import { describe, expect, it } from "vitest";
import type { ExperienceGroup } from "@gotcha/cpkmn";
import { ACTIVE_EXPERIENCE_PER_HOUR, EVOLUTION_SNOOZE, FRIENDSHIP_MAX, FRIENDSHIP_TIERS, HOUR, MAX_LEVEL } from "./constants";
import { freshStats } from "./defaults";
import { activeTimeExperience, addExperience, adjustFriendship, declineEvolution, evolutionOptions, evolutionProspects, evolvedStats, experienceForLevel, experienceToLevel, friendshipDelta } from "./growth";
import { expectPure } from "./testing";
import type { EvolutionRule, SpeciesFacts } from "./types";

const GROUPS: ExperienceGroup[] = ["erratic", "fast", "medium_fast", "medium_slow", "slow", "fluctuating"];
const NOW = "2026-11-01T12:00:00.000Z";

describe("experience groups", () => {
  it("matches the games at level 100 and starts at 0", () => {
    const at100: Record<ExperienceGroup, number> = {
      erratic: 600_000,
      fast: 800_000,
      medium_fast: 1_000_000,
      medium_slow: 1_059_860,
      slow: 1_250_000,
      fluctuating: 1_640_000,
    };
    for (const group of GROUPS) {
      expect(experienceForLevel(group, MAX_LEVEL)).toBe(at100[group]);
      expect(experienceForLevel(group, 1)).toBe(0);
    }
  });

  it("matches known mid-table values", () => {
    expect(experienceForLevel("medium_fast", 10)).toBe(1_000);
    expect(experienceForLevel("medium_slow", 10)).toBe(560);
    expect(experienceForLevel("erratic", 50)).toBe(125_000);
    expect(experienceForLevel("fluctuating", 15)).toBe(1_957);
  });

  it("is strictly increasing and experienceToLevel inverts it", () => {
    for (const group of GROUPS) {
      for (let level = 2; level <= MAX_LEVEL; level++) {
        const exp = experienceForLevel(group, level);
        expect(exp).toBeGreaterThan(experienceForLevel(group, level - 1));
        expect(experienceToLevel(group, exp)).toBe(level);
        expect(experienceToLevel(group, exp - 1)).toBe(level - 1);
      }
      expect(experienceToLevel(group, 0)).toBe(1);
      expect(experienceToLevel(group, Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
    }
  });
});

describe("addExperience", () => {
  it("does not mutate its input", () => {
    expectPure(freshStats(), (s) => addExperience(s, 10_000, NOW));
  });

  it("levels up through every level reached and reports each", () => {
    const r = addExperience(freshStats("medium_fast"), experienceForLevel("medium_fast", 4), NOW);
    expect(r.stats.level).toBe(4);
    expect(r.levelsGained).toEqual([2, 3, 4]);
    expect(r.events.map((e) => e.detail)).toEqual(["2", "3", "4"]);
  });

  it("caps at the maximum level and rejects negative amounts", () => {
    const r = addExperience(freshStats("fast"), 1e12, NOW);
    expect(r.stats).toMatchObject({ level: MAX_LEVEL, experience: experienceForLevel("fast", MAX_LEVEL) });
    expect(() => addExperience(freshStats(), -1, NOW)).toThrow();
  });

  it("pays for time as the active pokemon", () => {
    expect(activeTimeExperience(2 * HOUR)).toBe(2 * ACTIVE_EXPERIENCE_PER_HOUR);
    expect(activeTimeExperience(-HOUR)).toBe(0);
  });
});

describe("friendship", () => {
  it("does not mutate its input", () => {
    expectPure(freshStats(), (s) => adjustFriendship(s, 5));
  });

  it("shrinks gains by tier and leaves losses alone", () => {
    for (let i = 0; i < FRIENDSHIP_TIERS.length; i++) {
      const current = FRIENDSHIP_TIERS[i].below - 1;
      expect(friendshipDelta(current, 10)).toBeCloseTo(10 * FRIENDSHIP_TIERS[i].factor, 9);
      expect(friendshipDelta(current, -10)).toBe(-10);
    }
  });

  it("clamps to the games' scale", () => {
    expect(adjustFriendship({ ...freshStats(), friendship: FRIENDSHIP_MAX }, 100).friendship).toBe(FRIENDSHIP_MAX);
    expect(adjustFriendship({ ...freshStats(), friendship: 2 }, -100).friendship).toBe(0);
  });
});

describe("evolutionOptions", () => {
  const rules: EvolutionRule[] = [
    { to: "ivysaur", trigger: "level", minLevel: 16 },
    { to: "espeon", trigger: "friendship", minFriendship: 220 },
    { to: "vaporeon", trigger: "item", item: "water_stone" },
    { to: "machamp", trigger: "trade" },
  ];
  const species: SpeciesFacts = { species: "test", experienceGroup: "medium_fast", evolutions: rules };
  const bag = { heldItem: null };

  it("does not mutate its inputs", () => {
    expectPure({ stats: freshStats(), species, inv: { heldItem: "water_stone", bag: ["link_cable"] } }, (i) => evolutionOptions(i.stats, i.species, i.inv, NOW));
  });

  it("checks level, friendship, item and trade triggers", () => {
    expect(evolutionOptions(freshStats(), species, bag, NOW)).toEqual([]);
    expect(evolutionOptions({ ...freshStats(), level: 16 }, species, bag, NOW).map((r) => r.to)).toEqual(["ivysaur"]);
    expect(evolutionOptions({ ...freshStats(), friendship: 220 }, species, bag, NOW).map((r) => r.to)).toEqual(["espeon"]);
    expect(evolutionOptions(freshStats(), species, { heldItem: null, bag: ["water_stone"] }, NOW).map((r) => r.to)).toEqual(["vaporeon"]);
    expect(evolutionOptions(freshStats(), species, { heldItem: "water_stone" }, NOW).map((r) => r.to)).toEqual(["vaporeon"]);
    expect(evolutionOptions(freshStats(), species, { heldItem: null, bag: ["link_cable"] }, NOW).map((r) => r.to)).toEqual(["machamp"]);
  });

  it("respects the trainer saying no, forever or for now", () => {
    const ready = { ...freshStats(), level: 16 };
    expect(evolutionOptions({ ...ready, evolution: { blocked: true, stage: 1 } }, species, bag, NOW)).toEqual([]);
    const later = new Date(Date.parse(NOW) + HOUR).toISOString();
    const earlier = new Date(Date.parse(NOW) - HOUR).toISOString();
    expect(evolutionOptions({ ...ready, evolution: { blocked: false, declinedUntil: later, stage: 1 } }, species, bag, NOW)).toEqual([]);
    expect(evolutionOptions({ ...ready, evolution: { blocked: false, declinedUntil: earlier, stage: 1 } }, species, bag, NOW)).toHaveLength(1);
  });
});

describe("evolution prospects", () => {
  const facts: SpeciesFacts = {
    species: "test",
    experienceGroup: "medium_fast",
    evolutions: [
      { to: "charmeleon", trigger: "level", minLevel: 16 },
      { to: "flareon", trigger: "item", item: "fire_stone" },
      { to: "espeon", trigger: "friendship", minFriendship: 160 },
      { to: "machamp", trigger: "trade", minLevel: 30 },
    ],
  };

  it("asks about rules whose level and friendship hold, and names item and trade rules without the item", () => {
    const stats = { ...freshStats(), level: 16, friendship: 100 };
    expect(evolutionProspects(stats, facts, NOW).map((r) => r.to)).toEqual(["charmeleon", "flareon"]);
    const friendly = { ...stats, friendship: 160, level: 30 };
    expect(evolutionProspects(friendly, facts, NOW).map((r) => r.to)).toEqual(["charmeleon", "flareon", "espeon", "machamp"]);
  });

  it("stays quiet while declined, for the snooze or for good, and clears after an evolution", () => {
    const stats = { ...freshStats(), level: 20 };
    const later = new Date(Date.parse(NOW) + EVOLUTION_SNOOZE + 1000).toISOString();
    const snoozed = declineEvolution(stats, false, NOW);
    expect(evolutionProspects(snoozed, facts, NOW)).toEqual([]);
    expect(evolutionProspects(snoozed, facts, later).length).toBeGreaterThan(0);
    const never = declineEvolution(stats, true, NOW);
    expect(evolutionProspects(never, facts, later)).toEqual([]);
    const evolved = evolvedStats(never);
    expect(evolved.evolution).toEqual({ blocked: false, declinedUntil: null, stage: stats.evolution.stage + 1 });
    expect(evolved.level).toBe(20);
  });
});
