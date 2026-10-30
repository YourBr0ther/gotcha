// pnpm pokedex:build [--species a,b] [--refresh] [--out .pokedex-cache/species] [--cobblemon .cobblemon-cache] [--cache .pokedex-cache/pokeapi]
// pnpm pokedex:refresh   (the same with --refresh)

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_COBBLEMON_DIR, readCobblemonIndex, readCobblemonSpecies } from "./cobblemon.js";
import { dioramasFor } from "./habitats.js";
import { buildSpeciesFacts } from "./merge.js";
import { toPokeApiName } from "./names.js";
import { createPokeApiClient, DEFAULT_CACHE_DIR, type PokeApiBundle, type PokeApiClient } from "./pokeapi.js";
import type { SpeciesBundle, SpeciesIndex } from "./types.js";

export const DEFAULT_OUT = ".pokedex-cache/species";

interface Args {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else flags[arg.slice(2)] = "true";
      }
    } else positional.push(arg);
  }
  return { command, positional, flags };
}

const USAGE = `usage:
  pokedex:build [--species <a,b,...>] [--refresh] [--out <dir>] [--cobblemon <dir>] [--cache <dir>] [--verbose]`;

export interface BuildOptions {
  cobblemonDir: string;
  outDir: string;
  client: PokeApiClient;
  only?: string[];
  log?: (line: string) => void;
}

export interface BuildResult {
  built: string[];
  unknown: string[];
  failed: Record<string, string>;
  index: SpeciesIndex;
}

/** Builds every species (or `only`) into `<outDir>/<species>.json` plus `index.json`. */
export async function build({ cobblemonDir, outDir, client, only, log = () => {} }: BuildOptions): Promise<BuildResult> {
  const index = await readCobblemonIndex(cobblemonDir);
  const ids = (only ?? Object.keys(index.species)).map((s) => s.toLowerCase()).sort();
  for (const id of ids) if (!index.species[id]) throw new Error(`"${id}" is not in ${join(cobblemonDir, "index.json")}`);
  await mkdir(outDir, { recursive: true });

  const result: BuildResult = { built: [], unknown: [], failed: {}, index: { builtAt: new Date().toISOString(), cobblemonVersion: index.cobblemonVersion, species: {} } };
  let done = 0;
  // Species run a few at a time; the client itself caps requests in flight.
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const id = ids.shift();
      if (id === undefined) return;
      try {
        const bundle = await buildOne(id, cobblemonDir, client);
        await writeFile(join(outDir, `${id}.json`), JSON.stringify(bundle, null, 2));
        result.built.push(id);
        if (!bundle.pokeapi) result.unknown.push(id);
        result.index.species[id] = { name: index.species[id].name, dex: bundle.pokedex.nationalDex, pokeapi: bundle.pokeapi, dioramas: bundle.dioramas.preferred };
      } catch (err) {
        result.failed[id] = err instanceof Error ? err.message : String(err);
        log(`${id}: FAILED ${result.failed[id]}`);
      }
      done++;
      if (done % 50 === 0) log(`${done} species done, ${client.requests} requests`);
    }
  });
  await Promise.all(workers);
  result.built.sort();
  result.unknown.sort();
  result.index.species = Object.fromEntries(Object.entries(result.index.species).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(join(outDir, "index.json"), JSON.stringify(result.index, null, 2));
  return result;
}

export async function buildOne(id: string, cobblemonDir: string, client: PokeApiClient): Promise<SpeciesBundle> {
  const cobblemon = await readCobblemonSpecies(id, cobblemonDir);
  const pokeapi: PokeApiBundle | null = await client.bundle(toPokeApiName(id));
  const now = new Date().toISOString();
  const { pokedex, facts } = buildSpeciesFacts({ cobblemon, pokeapi, now });
  const dioramas = dioramasFor(cobblemon.spawnBiomes, pokedex.habitat, cobblemon.behaviour, cobblemon.spawns);
  return { pokedex, facts, dioramas, pokeapi: pokeapi !== null, sourcedAt: now };
}

export async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command !== "build") {
    console.error(USAGE);
    return 2;
  }
  const started = Date.now();
  const verbose = flags.verbose === "true";
  const client = createPokeApiClient({
    cacheDir: resolve(flags.cache ?? DEFAULT_CACHE_DIR),
    refresh: flags.refresh === "true",
    log: verbose ? (line) => console.error(line) : undefined,
  });
  const only = flags.species ? flags.species.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const result = await build({
    cobblemonDir: resolve(flags.cobblemon ?? DEFAULT_COBBLEMON_DIR),
    outDir: resolve(flags.out ?? DEFAULT_OUT),
    client,
    only,
    log: (line) => console.error(line),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`built ${result.built.length} species in ${seconds}s with ${client.requests} PokeAPI requests`);
  if (result.unknown.length) console.log(`PokeAPI does not know ${result.unknown.length}: ${result.unknown.join(", ")}`);
  const failed = Object.keys(result.failed);
  if (failed.length) {
    console.log(`failed ${failed.length}: ${failed.map((id) => `${id} (${result.failed[id]})`).join(", ")}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && /[\\/]cli\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
