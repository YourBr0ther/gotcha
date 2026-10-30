/**
 * Merges Cobblemon's species file with PokeAPI into the `.cpkmn` pokedex
 * snapshot and the engine's `SpeciesFacts`.
 *
 * Cobblemon wins wherever the two disagree about what is on screen: types,
 * base stats, experience group, evolutions, behaviour and pokedex lines.
 * PokeAPI fills in what Cobblemon does not carry: flavour text, habitat, egg
 * groups, generation, base happiness. Evolution requirements the engine
 * cannot check (time of day, biome, a known move) are dropped from the rule
 * and kept as `notes` so the brain can still mention them.
 */

import type { ExperienceGroup, IsoDate, Pokedex, StatBlock } from "@gotcha/cpkmn";
import type { EvolutionRule, SpeciesFacts } from "../../../src/lib/sim/types.js";
import type { CobblemonEvolution, CobblemonRequirement, CobblemonSpecies } from "./cobblemon.js";
import type { PokeApiBundle } from "./pokeapi.js";

/** The engine's facts plus what the brain and store want alongside them. */
export interface BuiltFacts extends SpeciesFacts {
  evolutions: EvolutionRule[];
  /** Evolution conditions the rules above could not express, one line each. */
  notes: string[];
  baseFriendship: number;
  captureRate: number | null;
  legendary: boolean;
}

export interface MergeInput {
  cobblemon: CobblemonSpecies;
  pokeapi: PokeApiBundle | null;
  now?: IsoDate;
}

export interface Merged {
  pokedex: Pokedex;
  facts: BuiltFacts;
}

const EXPERIENCE_GROUPS: Readonly<Record<string, ExperienceGroup>> = {
  erratic: "erratic",
  fast: "fast",
  medium_fast: "medium_fast",
  medium_slow: "medium_slow",
  slow: "slow",
  fluctuating: "fluctuating",
};

export function toExperienceGroup(cobblemon: string): ExperienceGroup {
  const group = EXPERIENCE_GROUPS[cobblemon.toLowerCase()];
  if (!group) throw new Error(`unknown Cobblemon experience group "${cobblemon}"`);
  return group;
}

export function toStatBlock(stats: CobblemonSpecies["species"]["baseStats"]): StatBlock {
  return { hp: stats.hp, atk: stats.attack, def: stats.defence, spa: stats.special_attack, spd: stats.special_defence, spe: stats.speed };
}

export function buildSpeciesFacts({ cobblemon, pokeapi, now }: MergeInput): Merged {
  const { species } = cobblemon;
  const api = pokeapi?.species ?? null;
  const sourcedAt = now ?? new Date().toISOString();
  const { rules, notes } = convertEvolutions(species.evolutions ?? []);

  const types = [species.primaryType, species.secondaryType].filter((t): t is string => typeof t === "string" && t.length > 0);
  const pokedex: Pokedex = {
    species: cobblemon.id,
    nationalDex: species.nationalPokedexNumber,
    types,
    eggGroups: api?.eggGroups.length ? api.eggGroups : species.eggGroups ?? [],
    habitat: api?.habitat ?? null,
    flavorTexts: api?.flavorTexts ?? [],
    cobblemonPokedexLines: cobblemon.pokedexLines,
    baseStats: toStatBlock(species.baseStats),
    behaviour: cobblemon.behaviour,
    spawnBiomes: cobblemon.spawnBiomes,
    sourcedAt,
  };
  if (api?.generation != null) pokedex.generation = api.generation;
  if (pokeapi?.chain) pokedex.evolutionChain = { id: pokeapi.chain.id, chain: pokeapi.chain.chain } as unknown as Record<string, unknown>;

  const facts: BuiltFacts = {
    species: cobblemon.id,
    experienceGroup: toExperienceGroup(species.experienceGroup),
    evolutions: rules,
    notes,
    baseFriendship: api?.baseHappiness ?? species.baseFriendship ?? 70,
    captureRate: api?.captureRate ?? species.catchRate ?? null,
    legendary: (api?.legendary || api?.mythical) ?? false,
  };
  return { pokedex, facts };
}

/** Cobblemon evolution entries to engine rules, with what got dropped written to notes. */
export function convertEvolutions(evolutions: readonly CobblemonEvolution[]): { rules: EvolutionRule[]; notes: string[] } {
  const rules: EvolutionRule[] = [];
  const notes: string[] = [];
  for (const evo of evolutions) {
    const { species: to, form } = splitResult(evo.result);
    const rule: EvolutionRule = { to, trigger: "level" };
    const dropped: string[] = [];
    if (form) dropped.push(`becomes the ${form} form`);

    if (evo.variant === "item_interact") {
      rule.trigger = "item";
      if (evo.requiredContext) rule.item = itemId(evo.requiredContext);
      else dropped.push("needs an item Cobblemon does not name");
    } else if (evo.variant === "trade") rule.trigger = "trade";
    else if (evo.variant !== "level_up") dropped.push(`Cobblemon evolution variant "${evo.variant}" is not supported; treated as level-up`);

    for (const req of evo.requirements ?? []) {
      const text = applyRequirement(rule, req);
      if (text) dropped.push(text);
    }

    if (evo.variant === "level_up") {
      // A held item or a friendship floor on a level-up is something the engine can check, so it becomes the trigger.
      if (rule.minFriendship !== undefined) rule.trigger = "friendship";
      else if (rule.item !== undefined) rule.trigger = "item";
      else if (rule.minLevel === undefined) dropped.push("Cobblemon sets no level for this evolution");
    }
    // Two Cobblemon entries that differ only in what the engine cannot see
    // (Pikachu's Alolan Raichu needs a biome) collapse into one rule; the notes keep both stories.
    if (!rules.some((r) => sameRule(r, rule))) rules.push(rule);
    for (const text of dropped) notes.push(`${to}: ${text}`);
  }
  return { rules, notes };
}

function sameRule(a: EvolutionRule, b: EvolutionRule): boolean {
  return a.to === b.to && a.trigger === b.trigger && a.minLevel === b.minLevel && a.minFriendship === b.minFriendship && a.item === b.item;
}

/** Folds one requirement into the rule when the engine can check it; otherwise returns the note to keep. */
function applyRequirement(rule: EvolutionRule, req: CobblemonRequirement): string | null {
  const r = req as Record<string, unknown>;
  switch (req.variant) {
    case "level":
      if (typeof r.minLevel === "number") rule.minLevel = r.minLevel;
      return null;
    case "friendship":
      if (typeof r.amount === "number") rule.minFriendship = r.amount;
      return null;
    case "held_item":
      if (typeof r.itemCondition === "string") rule.item = itemId(r.itemCondition);
      return rule.trigger === "trade" ? `while holding ${describeItem(String(r.itemCondition))}` : null;
    case "time_range":
      return `only at ${String(r.range)}`;
    case "biome":
      return `only in ${describeBiome(String(r.biomeCondition))}`;
    case "negate": {
      const inner = r.inner as CobblemonRequirement | undefined;
      if (!inner) return "an unstated condition must not hold";
      const scratch: EvolutionRule = { to: rule.to, trigger: rule.trigger };
      const text = applyRequirement(scratch, inner) ?? `${inner.variant} ${JSON.stringify(stripVariant(inner))}`;
      return `not ${text}`;
    }
    case "has_move":
      return `must know the move ${String(r.move)}`;
    case "has_move_type":
      return `must know a ${String(r.type)}-type move`;
    case "use_move":
      return `must have used ${String(r.move)} ${String(r.amount)} times`;
    case "properties":
      return `only when ${String(r.target)}`;
    case "property_range":
      return `only when ${String(r.feature)} is within ${String(r.range)}`;
    case "party_member":
      return r.contains === false ? `without ${String(r.target)} in the party` : `with ${String(r.target)} in the party`;
    case "defeat":
      return `after defeating ${String(r.amount)} ${String(r.target)}`;
    case "blocks_traveled":
      return `after travelling ${String(r.amount)} blocks`;
    case "weather":
      return r.isRaining ? "only while it rains" : "only in clear weather";
    case "structure":
      return `only near ${describeBiome(String(r.structureCondition))}`;
    case "advancement":
      return `after the advancement ${String(r.requiredAdvancement)}`;
    case "stat_compare":
      return `only when ${String(r.highStat)} is higher than ${String(r.lowStat)}`;
    case "stat_equal":
      return `only when ${String(r.statOne)} equals ${String(r.statTwo)}`;
    case "moon_phase":
      return `only under a ${String(r.moonPhase).toLowerCase().replace(/_/g, " ")}`;
    default:
      return `${req.variant} ${JSON.stringify(stripVariant(req))}`;
  }
}

/** "raichu alolan" is species `raichu` in form `alolan`; "gholdengo netherite_coating=stage1" carries a property. */
export function splitResult(result: string): { species: string; form?: string } {
  const [species, ...rest] = result.trim().split(/\s+/);
  const form = rest.filter((part) => !part.includes("=")).join(" ");
  return form ? { species, form } : { species };
}

/** `cobblemon:thunder_stone` is `thunder_stone` in the store; a `#tag` loses its hash too. */
export function itemId(resource: string): string {
  return resource.replace(/^#/, "").replace(/^[a-z_]+:/, "");
}

function describeItem(resource: string): string {
  return itemId(resource).replace(/_/g, " ");
}

function describeBiome(tag: string): string {
  const name = tag.replace(/^#/, "").replace(/^.*\//, "").replace(/^[a-z_]+:/, "");
  return name.replace(/_/g, " ").replace(/^is /, "");
}

function stripVariant(req: CobblemonRequirement): Record<string, unknown> {
  const { variant: _variant, ...rest } = req as Record<string, unknown>;
  return rest;
}
