/**
 * A small PokeAPI client.
 *
 * Every response is written to `<cacheDir>/<endpoint>/<id>.json` and read
 * from there on the next run, so the API is hit once per species unless the
 * caller passes `refresh`. Requests go out at most four at a time with 250 ms
 * between starts, which is the modest rate PokeAPI asks for. `fetch` is
 * injectable so tests can point the client at recorded fixtures and a fetch
 * that throws.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { StatBlock } from "@gotcha/cpkmn";

export const POKEAPI_BASE = "https://pokeapi.co/api/v2/";
export const DEFAULT_CACHE_DIR = ".pokedex-cache/pokeapi";
export const USER_AGENT = "gotcha-pokedex/0.1 (Gotcha; https://github.com/gotcha)";
export const MAX_IN_FLIGHT = 4;
export const REQUEST_SPACING_MS = 250;

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export interface PokeApiClientOptions {
  cacheDir?: string;
  /** Bypass the on-disk cache and fetch again. */
  refresh?: boolean;
  fetch?: FetchLike;
  baseUrl?: string;
  maxInFlight?: number;
  spacingMs?: number;
  log?: (line: string) => void;
}

const named = z.object({ name: z.string() });
const nullableNamed = named.nullable();

const speciesSchema = z.object({
  id: z.number(),
  name: z.string(),
  base_happiness: z.number().nullable(),
  capture_rate: z.number(),
  growth_rate: nullableNamed,
  egg_groups: z.array(named),
  habitat: nullableNamed,
  generation: z.object({ name: z.string(), url: z.string() }).nullable(),
  evolution_chain: z.object({ url: z.string() }).nullable(),
  is_legendary: z.boolean().optional(),
  is_mythical: z.boolean().optional(),
  flavor_text_entries: z.array(z.object({ flavor_text: z.string(), language: named, version: z.object({ name: z.string(), url: z.string() }) })),
  varieties: z.array(z.object({ is_default: z.boolean(), pokemon: named })),
});

const pokemonSchema = z.object({
  id: z.number(),
  name: z.string(),
  types: z.array(z.object({ slot: z.number(), type: named })),
  stats: z.array(z.object({ base_stat: z.number(), stat: named })),
});

const chainLinkSchema: z.ZodType<RawChainLink> = z.lazy(() =>
  z.object({
    is_baby: z.boolean().optional(),
    species: named,
    evolution_details: z.array(z.record(z.string(), z.unknown())),
    evolves_to: z.array(chainLinkSchema),
  }),
);
const chainSchema = z.object({ id: z.number(), chain: chainLinkSchema });

interface RawChainLink {
  is_baby?: boolean;
  species: { name: string };
  evolution_details: Record<string, unknown>[];
  evolves_to: RawChainLink[];
}

export interface PokeApiSpecies {
  id: number;
  name: string;
  /** English, de-duplicated, newest game first. */
  flavorTexts: string[];
  habitat: string | null;
  eggGroups: string[];
  growthRate: string | null;
  baseHappiness: number | null;
  captureRate: number;
  generation: number | null;
  legendary: boolean;
  mythical: boolean;
  evolutionChainId: number | null;
  /** The `pokemon/{name}` to ask for types and stats (`deoxys` is `deoxys-normal` there). */
  defaultPokemon: string;
}

export interface PokeApiPokemon {
  id: number;
  name: string;
  types: string[];
  baseStats: StatBlock;
}

export interface ChainLink {
  species: string;
  isBaby?: boolean;
  /** Evolution details with null, false and empty fields dropped and `{name}` refs flattened. */
  details: Record<string, unknown>[];
  evolvesTo: ChainLink[];
}

export interface PokeApiChain {
  id: number;
  chain: ChainLink;
}

export interface PokeApiBundle {
  species: PokeApiSpecies;
  pokemon: PokeApiPokemon | null;
  chain: PokeApiChain | null;
}

export class PokeApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PokeApiError";
  }
}

const NOT_FOUND = { notFound: true } as const;

export class PokeApiClient {
  private readonly cacheDir: string;
  private readonly refresh: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly maxInFlight: number;
  private readonly spacingMs: number;
  private readonly log: (line: string) => void;
  private inFlight = 0;
  private nextStartAt = 0;
  private readonly waiting: Array<() => void> = [];
  /** De-duplicates concurrent requests for the same key. */
  private readonly pending = new Map<string, Promise<unknown>>();
  /** Requests that reached the network (not served from cache) this session. */
  requests = 0;

  constructor(options: PokeApiClientOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.refresh = options.refresh ?? false;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl ?? POKEAPI_BASE;
    this.maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT;
    this.spacingMs = options.spacingMs ?? REQUEST_SPACING_MS;
    this.log = options.log ?? (() => {});
  }

  /** Flavor text, habitat, egg groups and friends. `null` when PokeAPI has no such species. */
  async species(name: string): Promise<PokeApiSpecies | null> {
    const raw = await this.get("pokemon-species", name);
    if (raw === null) return null;
    const parsed = speciesSchema.parse(raw);
    const english = parsed.flavor_text_entries
      .filter((e) => e.language.name === "en")
      .map((e) => ({ text: cleanFlavorText(e.flavor_text), version: idFromUrl(e.version.url) ?? 0 }))
      .sort((a, b) => b.version - a.version);
    const seen = new Set<string>();
    const flavorTexts: string[] = [];
    for (const { text } of english) {
      const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      flavorTexts.push(text);
    }
    const defaultVariety = parsed.varieties.find((v) => v.is_default) ?? parsed.varieties[0];
    return {
      id: parsed.id,
      name: parsed.name,
      flavorTexts,
      habitat: parsed.habitat?.name ?? null,
      eggGroups: parsed.egg_groups.map((g) => g.name),
      growthRate: parsed.growth_rate?.name ?? null,
      baseHappiness: parsed.base_happiness,
      captureRate: parsed.capture_rate,
      generation: parsed.generation ? idFromUrl(parsed.generation.url) : null,
      legendary: parsed.is_legendary ?? false,
      mythical: parsed.is_mythical ?? false,
      evolutionChainId: parsed.evolution_chain ? idFromUrl(parsed.evolution_chain.url) : null,
      defaultPokemon: defaultVariety?.pokemon.name ?? parsed.name,
    };
  }

  /** Types and base stats for one `pokemon/{name}` (a variety, not a species). */
  async pokemon(name: string): Promise<PokeApiPokemon | null> {
    const raw = await this.get("pokemon", name);
    if (raw === null) return null;
    const parsed = pokemonSchema.parse(raw);
    const stat = (n: string) => parsed.stats.find((s) => s.stat.name === n)?.base_stat ?? 0;
    return {
      id: parsed.id,
      name: parsed.name,
      types: [...parsed.types].sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
      baseStats: { hp: stat("hp"), atk: stat("attack"), def: stat("defense"), spa: stat("special-attack"), spd: stat("special-defense"), spe: stat("speed") },
    };
  }

  async evolutionChain(id: number): Promise<PokeApiChain | null> {
    const raw = await this.get("evolution-chain", String(id));
    if (raw === null) return null;
    const parsed = chainSchema.parse(raw);
    return { id: parsed.id, chain: compactLink(parsed.chain) };
  }

  /** Species, its default pokemon and its chain in one call. `null` when the species is unknown. */
  async bundle(speciesName: string): Promise<PokeApiBundle | null> {
    const species = await this.species(speciesName);
    if (!species) return null;
    const [pokemon, chain] = await Promise.all([
      this.pokemon(species.defaultPokemon),
      species.evolutionChainId === null ? Promise.resolve(null) : this.evolutionChain(species.evolutionChainId),
    ]);
    return { species, pokemon, chain };
  }

  /** Raw JSON for `<endpoint>/<id>`, from cache when present. `null` for a 404 (also cached). */
  async get(endpoint: string, id: string): Promise<unknown> {
    const key = `${endpoint}/${id}`;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const task = this.load(endpoint, id).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private async load(endpoint: string, id: string): Promise<unknown> {
    const file = join(this.cacheDir, endpoint, `${id}.json`);
    if (!this.refresh) {
      const cached = await readJson(file);
      if (cached !== undefined) return isNotFound(cached) ? null : cached;
    }
    const body = await this.request(`${this.baseUrl}${endpoint}/${id}/`);
    const value = body === null ? NOT_FOUND : (JSON.parse(body) as unknown);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return body === null ? null : value;
  }

  /** One network request under the concurrency and spacing limits. `null` on 404. */
  private async request(url: string): Promise<string | null> {
    await this.acquire();
    try {
      this.requests++;
      this.log(`GET ${url}`);
      const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new PokeApiError(`PokeAPI ${res.status} for ${url}`, res.status);
      return await res.text();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.inFlight >= this.maxInFlight) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight++;
    const now = Date.now();
    const startAt = Math.max(now, this.nextStartAt);
    this.nextStartAt = startAt + this.spacingMs;
    if (startAt > now) await sleep(startAt - now);
  }

  private release(): void {
    this.inFlight--;
    this.waiting.shift()?.();
  }
}

export function createPokeApiClient(options?: PokeApiClientOptions): PokeApiClient {
  return new PokeApiClient(options);
}

/** Game text comes with hard wraps and form feeds; fold them into spaces. */
export function cleanFlavorText(text: string): string {
  return text.replace(/\f/g, " ").replace(/­\n/g, "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function idFromUrl(url: string): number | null {
  const match = /\/(\d+)\/?$/.exec(url);
  return match ? Number(match[1]) : null;
}

function compactLink(link: RawChainLink): ChainLink {
  const out: ChainLink = { species: link.species.name, details: link.evolution_details.map(compactDetails), evolvesTo: link.evolves_to.map(compactLink) };
  if (link.is_baby) out.isBaby = true;
  return out;
}

function compactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === false || value === "" || key === "version_group") continue;
    if (typeof value === "object" && value !== null && "name" in value) out[key] = (value as { name: string }).name;
    else out[key] = value;
  }
  return out;
}

function isNotFound(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { notFound?: unknown }).notFound === true;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
