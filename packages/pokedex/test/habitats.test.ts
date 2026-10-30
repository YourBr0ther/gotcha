import { describe, expect, it } from "vitest";
import { readCobblemonSpecies } from "../src/cobblemon";
import { BIOME_TAGS, DIORAMA_IDS, POKEAPI_HABITATS, dioramasFor, isWaterOnly, type DioramaId } from "../src/habitats";
import { COBBLEMON_FIXTURES, fixtureClient } from "./helpers";

const DRY: DioramaId[] = ["meadow", "forest", "cave", "snowfield"];

async function choose(id: string) {
  const cobblemon = await readCobblemonSpecies(id, COBBLEMON_FIXTURES);
  const api = await fixtureClient().species(id);
  return dioramasFor(cobblemon.spawnBiomes, api?.habitat, cobblemon.behaviour, cobblemon.spawns);
}

describe("habitat table", () => {
  it("only names dioramas that exist", () => {
    const known = new Set<string>(DIORAMA_IDS);
    for (const [tag, votes] of Object.entries(BIOME_TAGS)) for (const id of Object.keys(votes)) expect(known.has(id), `${tag} -> ${id}`).toBe(true);
    for (const [habitat, votes] of Object.entries(POKEAPI_HABITATS)) for (const id of Object.keys(votes)) expect(known.has(id), `${habitat} -> ${id}`).toBe(true);
    expect(DIORAMA_IDS).toEqual(["meadow", "forest", "beach", "cave", "snowfield", "pond"]);
  });

  it("covers every PokeAPI habitat", () => {
    for (const habitat of ["cave", "forest", "grassland", "mountain", "rare", "rough-terrain", "sea", "urban", "waters-edge"]) expect(POKEAPI_HABITATS).toHaveProperty(habitat);
  });
});

describe("dioramasFor", () => {
  it("gives magikarp no dry diorama", async () => {
    const choice = await choose("magikarp");
    expect(choice.preferred).toEqual(["pond"]);
    expect(choice.allowed).toEqual(["pond", "beach"]);
    for (const id of [...choice.preferred, ...choice.allowed]) expect(DRY).not.toContain(id);
  });

  it("sends zubat to the cave first", async () => {
    const choice = await choose("zubat");
    expect(choice.preferred).toEqual(["cave"]);
    expect(choice.allowed[0]).toBe("cave");
    expect(choice.allowed).toContain("forest");
  });

  it("lets eevee roam but keeps it out of the pond it avoids", async () => {
    const choice = await choose("eevee");
    expect(choice.preferred).toEqual(["meadow", "forest"]);
    expect(choice.allowed).toContain("pond");
    expect(choice.preferred).not.toContain("pond");
  });

  it("falls back to the meadow when nothing votes", () => {
    expect(dioramasFor([], null)).toEqual({ preferred: ["meadow"], allowed: ["meadow"] });
    expect(dioramasFor(["#somemod:unknown_tag"], "rare", {})).toEqual({ preferred: ["meadow"], allowed: ["meadow"] });
  });

  it("gives a water-only species with no votes pond and beach", () => {
    expect(dioramasFor([], null, { moving: { walk: { avoidsLand: true } } })).toEqual({ preferred: ["pond"], allowed: ["pond", "beach"] });
    expect(dioramasFor(["#cobblemon:is_forest"], "forest", { moving: { swim: { canSwimInWater: true }, walk: { canWalk: false } } })).toEqual({ preferred: ["pond"], allowed: ["pond", "beach"] });
  });

  it("never returns an empty allowed list or a preferred diorama outside allowed", () => {
    const cases: Array<[string[], string | null]> = [[[], null], [["#cobblemon:is_freezing"], "mountain"], [["#cobblemon:is_ocean", "#cobblemon:is_beach"], "sea"], [["#cobblemon:is_overworld"], null]];
    for (const [tags, habitat] of cases) {
      const choice = dioramasFor(tags, habitat);
      expect(choice.allowed.length).toBeGreaterThan(0);
      expect(choice.preferred.length).toBeGreaterThan(0);
      for (const id of choice.preferred) expect(choice.allowed).toContain(id);
    }
  });

  it("lets the PokeAPI habitat outweigh a single biome tag", () => {
    expect(dioramasFor(["#cobblemon:is_forest"], "cave").preferred).toEqual(["cave"]);
    expect(dioramasFor(["#cobblemon:is_freezing"], "grassland").preferred).toEqual(["meadow"]);
  });

  it("knows who cannot leave the water", () => {
    expect(isWaterOnly({ moving: { walk: { avoidsLand: true } } })).toBe(true);
    expect(isWaterOnly({ moving: { swim: { canSwimInWater: true }, walk: { canWalk: false } } })).toBe(true);
    expect(isWaterOnly({ moving: { swim: { canSwimInWater: true }, walk: { canWalk: false }, fly: { canFly: true } } })).toBe(false);
    expect(isWaterOnly({ moving: { walk: { canWalk: false }, fly: { canFly: true } } })).toBe(false);
    expect(isWaterOnly({ moving: { swim: { avoidsWater: true } } })).toBe(false);
    expect(isWaterOnly(undefined)).toBe(false);
  });
});
