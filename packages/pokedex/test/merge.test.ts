import { describe, expect, it } from "vitest";
import { readCobblemonSpecies, fromJson, type CobblemonEvolution } from "../src/cobblemon";
import { buildSpeciesFacts, convertEvolutions, itemId, splitResult, toExperienceGroup } from "../src/merge";
import type { PokeApiBundle } from "../src/pokeapi";
import { COBBLEMON_FIXTURES, fixtureClient } from "./helpers";

const NOW = "2026-10-30T12:00:00.000Z";

async function merged(id: string) {
  const cobblemon = await readCobblemonSpecies(id, COBBLEMON_FIXTURES);
  const pokeapi = await fixtureClient().bundle(id);
  return { cobblemon, pokeapi, ...buildSpeciesFacts({ cobblemon, pokeapi, now: NOW }) };
}

describe("evolution conversion", () => {
  it("turns eevee's eight branches into five item rules and three friendship rules, with day, night and fairy noted", async () => {
    const { facts } = await merged("eevee");
    expect(facts.evolutions).toEqual([
      { to: "vaporeon", trigger: "item", item: "water_stone" },
      { to: "jolteon", trigger: "item", item: "thunder_stone" },
      { to: "flareon", trigger: "item", item: "fire_stone" },
      { to: "espeon", trigger: "friendship", minFriendship: 160 },
      { to: "umbreon", trigger: "friendship", minFriendship: 160 },
      { to: "leafeon", trigger: "item", item: "leaf_stone" },
      { to: "glaceon", trigger: "item", item: "ice_stone" },
      { to: "sylveon", trigger: "friendship", minFriendship: 160 },
    ]);
    expect(facts.notes).toEqual(["espeon: only at day", "umbreon: only at night", "sylveon: must know a fairy-type move"]);
  });

  it("gives magikarp a level 20 rule and zubat a level 22 rule with nothing dropped", async () => {
    expect((await merged("magikarp")).facts).toMatchObject({ evolutions: [{ to: "gyarados", trigger: "level", minLevel: 20 }], notes: [] });
    expect((await merged("zubat")).facts).toMatchObject({ evolutions: [{ to: "golbat", trigger: "level", minLevel: 22 }], notes: [] });
  });

  it("collapses pikachu's Alolan branch into the one thunder stone rule the engine can check", async () => {
    const { facts } = await merged("pikachu");
    expect(facts.evolutions).toEqual([{ to: "raichu", trigger: "item", item: "thunder_stone" }]);
    expect(facts.notes).toEqual(["raichu: becomes the alolan form", "raichu: only in pikachu alolabiome"]);
  });

  it("maps friendship on level-up to a friendship trigger, as golbat to crobat", () => {
    const { rules, notes } = convertEvolutions([{ variant: "level_up", result: "crobat", requirements: [{ variant: "friendship", amount: 160 }] }]);
    expect(rules).toEqual([{ to: "crobat", trigger: "friendship", minFriendship: 160 }]);
    expect(notes).toEqual([]);
  });

  it("keeps a level alongside friendship, item and trade triggers", () => {
    const { rules } = convertEvolutions([
      { variant: "level_up", result: "a", requirements: [{ variant: "friendship", amount: 120 }, { variant: "level", minLevel: 10 }] },
      { variant: "level_up", result: "b", requirements: [{ variant: "held_item", itemCondition: "cobblemon:razor_claw" }, { variant: "level", minLevel: 30 }] },
      { variant: "trade", result: "c", requirements: [{ variant: "held_item", itemCondition: "cobblemon:metal_coat" }] },
      { variant: "item_interact", result: "d", requiredContext: "cobblemon:moon_stone", requirements: [{ variant: "level", minLevel: 5 }] },
    ]);
    expect(rules).toEqual([
      { to: "a", trigger: "friendship", minFriendship: 120, minLevel: 10 },
      { to: "b", trigger: "item", item: "razor_claw", minLevel: 30 },
      { to: "c", trigger: "trade", item: "metal_coat" },
      { to: "d", trigger: "item", item: "moon_stone", minLevel: 5 },
    ]);
  });

  it("drops what the engine cannot check into notes and still emits a level rule", () => {
    const evolutions: CobblemonEvolution[] = [
      { variant: "level_up", result: "avalugg hisuian", requirements: [{ variant: "level", minLevel: 37 }, { variant: "biome", biomeCondition: "#cobblemon:evolution/regional/bergmite_hisuibiome" }, { variant: "negate", inner: { variant: "biome", biomeCondition: "#cobblemon:evolution/regional/bergmite_kalosbiome" } }] },
      { variant: "level_up", result: "ambipom", requirements: [{ variant: "has_move", move: "doublehit" }] },
      { variant: "level_up", result: "goodra", requirements: [{ variant: "level", minLevel: 50 }, { variant: "weather", isRaining: true }] },
      { variant: "level_up", result: "mantine", requirements: [{ variant: "party_member", target: "remoraid", contains: true }] },
      { variant: "trade", result: "huntail", requirements: [{ variant: "held_item", itemCondition: "cobblemon:deep_sea_tooth" }] },
      { variant: "item_interact", result: "ursaluna", requiredContext: "cobblemon:peat_block", requirements: [{ variant: "moon_phase", moonPhase: "FULL_MOON" }] },
      { variant: "level_up", result: "wormadam", requirements: [{ variant: "level", minLevel: 20 }, { variant: "properties", target: "gender=female" }] },
    ];
    const { rules, notes } = convertEvolutions(evolutions);
    expect(rules).toEqual([
      { to: "avalugg", trigger: "level", minLevel: 37 },
      { to: "ambipom", trigger: "level" },
      { to: "goodra", trigger: "level", minLevel: 50 },
      { to: "mantine", trigger: "level" },
      { to: "huntail", trigger: "trade", item: "deep_sea_tooth" },
      { to: "ursaluna", trigger: "item", item: "peat_block" },
      { to: "wormadam", trigger: "level", minLevel: 20 },
    ]);
    expect(notes).toEqual([
      "avalugg: becomes the hisuian form",
      "avalugg: only in bergmite hisuibiome",
      "avalugg: not only in bergmite kalosbiome",
      "ambipom: must know the move doublehit",
      "ambipom: Cobblemon sets no level for this evolution",
      "goodra: only while it rains",
      "mantine: with remoraid in the party",
      "mantine: Cobblemon sets no level for this evolution",
      "huntail: while holding deep sea tooth",
      "ursaluna: only under a full moon",
      "wormadam: only when gender=female",
    ]);
  });

  it("splits a Cobblemon result into species and form", () => {
    expect(splitResult("raichu alolan")).toEqual({ species: "raichu", form: "alolan" });
    expect(splitResult("gholdengo netherite_coating=stage1")).toEqual({ species: "gholdengo" });
    expect(splitResult("gyarados")).toEqual({ species: "gyarados" });
    expect(itemId("cobblemon:thunder_stone")).toBe("thunder_stone");
    expect(itemId("#cobblemon:azalea_tree")).toBe("azalea_tree");
  });
});

describe("experience group", () => {
  it("maps Cobblemon's strings onto the engine union and rejects strangers", () => {
    expect(toExperienceGroup("medium_slow")).toBe("medium_slow");
    expect(toExperienceGroup("Fluctuating")).toBe("fluctuating");
    expect(() => toExperienceGroup("glacial")).toThrow(/glacial/);
  });
});

describe("merge precedence", () => {
  it("takes types, stats, experience group, behaviour and pokedex lines from Cobblemon; flavor, habitat, egg groups, generation and happiness from PokeAPI", async () => {
    const { cobblemon, pokeapi, pokedex, facts } = await merged("eevee");
    const rigged: PokeApiBundle = {
      ...pokeapi!,
      species: { ...pokeapi!.species, growthRate: "slow", baseHappiness: 123 },
      pokemon: { ...pokeapi!.pokemon!, types: ["ghost", "steel"], baseStats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } },
    };
    const out = buildSpeciesFacts({ cobblemon, pokeapi: rigged, now: NOW });
    expect(out.pokedex.types).toEqual(["normal"]);
    expect(out.pokedex.baseStats).toEqual({ hp: 55, atk: 55, def: 50, spa: 45, spd: 65, spe: 55 });
    expect(out.facts.experienceGroup).toBe("medium_fast");
    expect(out.pokedex.behaviour).toBe(cobblemon.behaviour);
    expect(out.pokedex.cobblemonPokedexLines).toEqual([expect.stringMatching(/^Eevee has an unstable genetic makeup/)]);

    expect(out.facts.baseFriendship).toBe(123);
    expect(pokedex.eggGroups).toEqual(["ground"]);
    expect(pokedex.habitat).toBe("urban");
    expect(pokedex.generation).toBe(1);
    expect(pokedex.flavorTexts?.length).toBeGreaterThan(10);
    expect(pokedex.evolutionChain).toMatchObject({ id: 67 });
    expect(pokedex).toMatchObject({ species: "eevee", nationalDex: 133, sourcedAt: NOW });
    expect(pokedex.spawnBiomes).toContain("#cobblemon:is_temperate");
    expect(facts.captureRate).toBe(45);
  });

  it("builds from Cobblemon alone when PokeAPI does not know the species", async () => {
    const cobblemon = await readCobblemonSpecies("zubat", COBBLEMON_FIXTURES);
    const { pokedex, facts } = buildSpeciesFacts({ cobblemon, pokeapi: null, now: NOW });
    expect(pokedex.types).toEqual(["poison", "flying"]);
    expect(pokedex.flavorTexts).toEqual([]);
    expect(pokedex.habitat).toBeNull();
    expect(pokedex.generation).toBeUndefined();
    expect(pokedex.evolutionChain).toBeUndefined();
    expect(pokedex.eggGroups).toEqual(["flying"]);
    expect(facts.baseFriendship).toBe(50);
    expect(facts.captureRate).toBe(255);
    expect(facts.evolutions).toEqual([{ to: "golbat", trigger: "level", minLevel: 22 }]);
  });

  it("reads spawn hints and lang lines out of the Cobblemon JSON", () => {
    const species = fromJson(
      "testmon",
      { name: "Testmon", nationalPokedexNumber: 9999, primaryType: "rock", experienceGroup: "slow", baseStats: { hp: 1, attack: 2, defence: 3, special_attack: 4, special_defence: 5, speed: 6 }, pokedex: ["cobblemon.species.testmon.desc", "missing.key"] },
      { "cobblemon.species.testmon.desc": "A rock." },
      { "9999_testmon.json": { spawns: [{ condition: { biomes: ["#cobblemon:is_dripstone"], canSeeSky: false } }, { spawnablePositionType: "submerged", condition: { biomes: ["#cobblemon:is_ocean"], canSeeSky: false } }] } },
    );
    expect(species.pokedexLines).toEqual(["A rock."]);
    expect(species.spawnBiomes).toEqual(["#cobblemon:is_dripstone", "#cobblemon:is_ocean"]);
    expect(species.spawns.map((s) => s.underground)).toEqual([true, false]);
  });
});
