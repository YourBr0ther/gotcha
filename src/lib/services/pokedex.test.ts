import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStarterSpecies, starterSpecies } from "./pokedex";

let previous: string | undefined;
beforeEach(() => {
  previous = process.env.POKEDEX_CACHE_DIR;
  resetStarterSpecies();
});
afterEach(() => {
  if (previous === undefined) delete process.env.POKEDEX_CACHE_DIR;
  else process.env.POKEDEX_CACHE_DIR = previous;
  resetStarterSpecies();
});

describe("starterSpecies", () => {
  it("reads name, dex, types and dioramas from the pokedex cache for species the asset cache has", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gotcha-pokedex-"));
    const species = path.join(dir, "species");
    await mkdir(species, { recursive: true });
    await writeFile(
      path.join(species, "index.json"),
      JSON.stringify({
        species: {
          eevee: { name: "Eevee", dex: 133, pokeapi: true, dioramas: ["meadow", "forest"] },
          pikachu: { name: "Pikachu", dex: 25, pokeapi: true, dioramas: ["forest"] },
          // Built in the pokedex but not extracted from the mod: no assets, so not a starter.
          missingno: { name: "Missingno", dex: 0, pokeapi: false, dioramas: [] },
        },
      }),
    );
    await writeFile(path.join(species, "eevee.json"), JSON.stringify({ pokedex: { types: ["normal"] } }));
    // No pikachu.json: the species file is optional, types just come back empty.
    process.env.POKEDEX_CACHE_DIR = dir;

    const list = await starterSpecies();
    expect(list).toEqual([
      { id: "pikachu", name: "Pikachu", dex: 25, types: [], dioramas: ["forest"] },
      { id: "eevee", name: "Eevee", dex: 133, types: ["normal"], dioramas: ["meadow", "forest"] },
    ]);
  });

  it("falls back to the asset cache index when the pokedex cache is absent", async () => {
    process.env.POKEDEX_CACHE_DIR = path.join(os.tmpdir(), "gotcha-no-such-pokedex-cache");
    const list = await starterSpecies();
    expect(list.length).toBeGreaterThan(100);
    const eevee = list.find((s) => s.id === "eevee");
    expect(eevee).toMatchObject({ name: "Eevee", dex: 133, types: ["normal"], dioramas: [] });
    expect(list.every((s) => typeof s.name === "string" && s.name.length > 0)).toBe(true);
  }, 30_000);
});
