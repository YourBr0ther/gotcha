import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, parseArgs } from "../src/cli";
import { loadSpecies, loadSpeciesIndex } from "../src/index";
import { COBBLEMON_FIXTURES, fixtureClient } from "./helpers";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("parses subcommand and flags in both spellings", () => {
  expect(parseArgs(["build", "--species", "eevee,zubat", "--refresh"])).toEqual({ command: "build", positional: [], flags: { species: "eevee,zubat", refresh: "true" } });
  expect(parseArgs(["build", "--out=.pokedex-cache/species"])).toEqual({ command: "build", positional: [], flags: { out: ".pokedex-cache/species" } });
  expect(parseArgs([])).toEqual({ command: undefined, positional: [], flags: {} });
});

describe("build", () => {
  it("writes one bundle per species plus an index, from fixtures alone", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pokedex-build-"));
    scratch.push(outDir);
    const result = await build({ cobblemonDir: COBBLEMON_FIXTURES, outDir, client: fixtureClient(), only: ["zubat", "Eevee"] });
    expect(result.built).toEqual(["eevee", "zubat"]);
    expect(result.unknown).toEqual([]);
    expect(result.failed).toEqual({});

    const eevee = await loadSpecies("eevee", outDir);
    expect(eevee).toMatchObject({ pokeapi: true, dioramas: { preferred: ["meadow", "forest"] } });
    expect(eevee?.facts.evolutions).toHaveLength(8);
    expect(eevee?.pokedex.sourcedAt).toBe(eevee?.sourcedAt);
    expect(await loadSpecies("magikarp", outDir)).toBeNull();

    const index = await loadSpeciesIndex(outDir);
    expect(index?.cobblemonVersion).toBe("1.8.4+1.21.1");
    expect(Object.keys(index!.species)).toEqual(["eevee", "zubat"]);
    expect(index?.species.zubat).toEqual({ name: "Zubat", dex: 41, pokeapi: true, dioramas: ["cave"] });
    expect(JSON.parse(await readFile(join(outDir, "index.json"), "utf8"))).toEqual(index);
  });

  it("rejects a species the Cobblemon index does not list", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pokedex-build-"));
    scratch.push(outDir);
    await expect(build({ cobblemonDir: COBBLEMON_FIXTURES, outDir, client: fixtureClient(), only: ["missingno"] })).rejects.toThrow(/missingno/);
  });
});
