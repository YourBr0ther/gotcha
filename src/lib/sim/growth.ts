/**
 * Levels, friendship and evolution eligibility. The engine never evolves a
 * pokemon on its own: evolutionOptions lists what is allowed and the
 * trainer confirms.
 */

import type { ExperienceGroup, IsoDate, Stats } from "@gotcha/cpkmn";
import { ACTIVE_EXPERIENCE_PER_HOUR, EVOLUTION_SNOOZE, FRIENDSHIP_MAX, FRIENDSHIP_TIERS, HOUR, MAX_LEVEL } from "./constants";
import type { EngineEvent, EvolutionRule, SpeciesFacts } from "./types";
import { clamp, parseIso, toIso } from "./util";

/** Total experience at the start of `level`, per the games' formulas. */
export function experienceForLevel(group: ExperienceGroup, level: number): number {
  const n = clamp(Math.floor(level), 1, MAX_LEVEL);
  if (n === 1) return 0;
  const n3 = n ** 3;
  switch (group) {
    case "fast":
      return Math.floor((4 * n3) / 5);
    case "medium_fast":
      return n3;
    case "medium_slow":
      return Math.floor((6 / 5) * n3 - 15 * n ** 2 + 100 * n - 140);
    case "slow":
      return Math.floor((5 * n3) / 4);
    case "erratic":
      if (n < 50) return Math.floor((n3 * (100 - n)) / 50);
      if (n < 68) return Math.floor((n3 * (150 - n)) / 100);
      if (n < 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n3 * (160 - n)) / 100);
    case "fluctuating":
      if (n < 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n < 36) return Math.floor((n3 * (n + 14)) / 50);
      return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
    default: {
      const never: never = group;
      throw new Error(`Unknown experience group: ${String(never)}`);
    }
  }
}

/** The level a total experience amount corresponds to. */
export function experienceToLevel(group: ExperienceGroup, experience: number): number {
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (experienceForLevel(group, mid) <= experience) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface ExperienceResult {
  stats: Stats;
  /** Every level reached, lowest first. */
  levelsGained: number[];
  events: EngineEvent[];
}

export function addExperience(stats: Stats, amount: number, now: IsoDate): ExperienceResult {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("experience must be a non-negative number");
  const cap = experienceForLevel(stats.experienceGroup, MAX_LEVEL);
  const experience = Math.min(cap, stats.experience + amount);
  const level = Math.max(stats.level, experienceToLevel(stats.experienceGroup, experience));
  const levelsGained: number[] = [];
  const events: EngineEvent[] = [];
  for (let l = stats.level + 1; l <= level; l++) {
    levelsGained.push(l);
    events.push({ kind: "level_up", at: now, detail: String(l) });
  }
  return { stats: { ...stats, experience, level }, levelsGained, events };
}

/** Experience for time spent as the active pokemon. */
export function activeTimeExperience(ms: number): number {
  return Math.max(0, (ms / HOUR) * ACTIVE_EXPERIENCE_PER_HOUR);
}

/** Gains shrink with the tiers in constants; losses apply as given. */
export function friendshipDelta(current: number, base: number): number {
  if (base <= 0) return base;
  const tier = FRIENDSHIP_TIERS.find((t) => current < t.below) ?? FRIENDSHIP_TIERS[FRIENDSHIP_TIERS.length - 1];
  return base * tier.factor;
}

export function adjustFriendship(stats: Stats, base: number): Stats {
  const friendship = clamp(Math.round(stats.friendship + friendshipDelta(stats.friendship, base)), 0, FRIENDSHIP_MAX);
  return { ...stats, friendship };
}

export interface EvolutionInventory {
  heldItem: string | null;
  /** Store item ids the trainer owns. */
  bag?: readonly string[];
}

export function evolutionOptions(stats: Stats, species: SpeciesFacts, inventory: EvolutionInventory, now: IsoDate): EvolutionRule[] {
  const nowMs = parseIso(now);
  if (stats.evolution.blocked) return [];
  if (stats.evolution.declinedUntil && parseIso(stats.evolution.declinedUntil) > nowMs) return [];
  const owned = new Set<string>(inventory.bag ?? []);
  if (inventory.heldItem) owned.add(inventory.heldItem);
  return (species.evolutions ?? []).filter((rule) => {
    if (rule.minLevel !== undefined && stats.level < rule.minLevel) return false;
    switch (rule.trigger) {
      case "level":
        return rule.minLevel !== undefined;
      case "friendship":
        return stats.friendship >= (rule.minFriendship ?? FRIENDSHIP_MAX);
      case "item":
        return rule.item !== undefined && owned.has(rule.item);
      case "trade":
        return owned.has("link_cable");
      default:
        return false;
    }
  });
}

/**
 * Evolutions worth asking the trainer about: level and friendship rules
 * whose conditions hold, and item and trade rules whose level holds, named
 * even without the item so the ask can say what it needs. Nothing while
 * the trainer has said never, or not now and the snooze is running.
 */
export function evolutionProspects(stats: Stats, species: SpeciesFacts, now: IsoDate): EvolutionRule[] {
  const nowMs = parseIso(now);
  if (stats.evolution.blocked) return [];
  if (stats.evolution.declinedUntil && parseIso(stats.evolution.declinedUntil) > nowMs) return [];
  return (species.evolutions ?? []).filter((rule) => {
    if (rule.minLevel !== undefined && stats.level < rule.minLevel) return false;
    switch (rule.trigger) {
      case "level":
        return rule.minLevel !== undefined;
      case "friendship":
        return stats.friendship >= (rule.minFriendship ?? FRIENDSHIP_MAX);
      case "item":
        return rule.item !== undefined;
      case "trade":
        return true;
      default:
        return false;
    }
  });
}

/** The trainer said no: for now, asked again after the snooze, or never. */
export function declineEvolution(stats: Stats, forever: boolean, now: IsoDate): Stats {
  const evolution = forever ? { ...stats.evolution, blocked: true, declinedUntil: null } : { ...stats.evolution, declinedUntil: toIso(parseIso(now) + EVOLUTION_SNOOZE) };
  return { ...stats, evolution };
}

/** Stats after an evolution: one stage up and no snooze left over. Level and experience carry across. */
export function evolvedStats(stats: Stats): Stats {
  return { ...stats, evolution: { blocked: false, declinedUntil: null, stage: stats.evolution.stage + 1 } };
}
