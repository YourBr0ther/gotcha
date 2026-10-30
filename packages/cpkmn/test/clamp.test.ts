import { describe, expect, it } from "vitest";
import { pack, unpack } from "../src";
import { ASSET_PACK, GENERATOR, encode, rebuild, syntheticPokemon, text } from "./helpers";

async function withMember(member: string, change: (value: Record<string, unknown>) => void) {
  const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
  return rebuild(bytes, {
    mutate: (files) => {
      const value = JSON.parse(text(files[member])) as Record<string, unknown>;
      change(value);
      files[member] = encode(value);
    },
    rehash: true,
  });
}

describe("clamps", () => {
  it("decay multipliers are clamped to 0.5..1.5 with a warning each", async () => {
    const file = await withMember("personality.json", (p) => {
      (p.decayMultipliers as Record<string, number>).hunger = 4;
      (p.decayMultipliers as Record<string, number>).energy = 0.1;
    });
    const { pokemon, warnings } = await unpack(file);
    expect(pokemon.personality.decayMultipliers.hunger).toBe(1.5);
    expect(pokemon.personality.decayMultipliers.energy).toBe(0.5);
    expect(pokemon.personality.decayMultipliers.hygiene).toBe(1.0);
    const clamped = warnings.filter((w) => w.code === "clamped");
    expect(clamped.map((w) => w.path).sort()).toEqual(["/decayMultipliers/energy", "/decayMultipliers/hunger"]);
    expect(clamped.every((w) => w.member === "personality.json")).toBe(true);
    expect(clamped[0].message).toMatch(/clamped to/);
  });

  it("friendship is clamped to 0..255", async () => {
    const high = await withMember("stats.json", (s) => (s.friendship = 300));
    const low = await withMember("stats.json", (s) => (s.friendship = -5));
    const a = await unpack(high);
    const b = await unpack(low);
    expect(a.pokemon.stats.friendship).toBe(255);
    expect(b.pokemon.stats.friendship).toBe(0);
    expect(a.warnings.find((w) => w.code === "clamped")).toMatchObject({ member: "stats.json", path: "/friendship" });
  });

  it("needs are clamped to 0..100", async () => {
    const file = await withMember("state.json", (s) => {
      (s.needs as Record<string, number>).hunger = 140;
      (s.needs as Record<string, number>).health = -20;
    });
    const { pokemon, warnings } = await unpack(file);
    expect(pokemon.state.needs.hunger).toBe(100);
    expect(pokemon.state.needs.health).toBe(0);
    expect(pokemon.state.needs.fun).toBe(55);
    expect(warnings.filter((w) => w.code === "clamped").map((w) => w.path).sort()).toEqual(["/needs/health", "/needs/hunger"]);
  });

  it("values already in range produce no clamp warning", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { warnings } = await unpack(bytes);
    expect(warnings.filter((w) => w.code === "clamped")).toEqual([]);
  });

  it("a non-number is left for the schema to reject", async () => {
    const file = await withMember("stats.json", (s) => (s.friendship = "lots"));
    await expect(unpack(file)).rejects.toMatchObject({ code: "schema", member: "stats.json" });
  });
});
