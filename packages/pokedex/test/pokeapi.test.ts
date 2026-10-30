import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanFlavorText, createPokeApiClient, idFromUrl, PokeApiError, type FetchLike } from "../src/pokeapi";
import { fixtureClient, noNetwork } from "./helpers";

const scratch: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pokedex-test-"));
  scratch.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeFetch(bodies: Record<string, unknown>, onCall?: (url: string) => void): FetchLike {
  return async (url) => {
    onCall?.(url);
    const key = url.replace(/^https?:\/\/[^/]+\/api\/v2\//, "").replace(/\/$/, "");
    const body = bodies[key];
    if (body === undefined) return { status: 404, ok: false, text: async () => "Not Found" };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
}

describe("species", () => {
  it("reads flavor texts in English, de-duplicated, newest game first", async () => {
    const eevee = await fixtureClient().species("eevee");
    expect(eevee).not.toBeNull();
    const texts = eevee!.flavorTexts;
    expect(texts[0]).toMatch(/^Harbors the potential to evolve into manifold forms/);
    expect(new Set(texts.map((t) => t.toLowerCase())).size).toBe(texts.length);
    expect(texts.filter((t) => t.startsWith("Its genetic code is irregular")).length).toBe(1);
    for (const text of texts) expect(text).not.toMatch(/[\n\f]/);
    expect(texts.some((t) => /[ぁ-ん一-龯]/.test(t))).toBe(false);
  });

  it("carries habitat, egg groups, growth rate, happiness, catch rate, generation and chain", async () => {
    const eevee = await fixtureClient().species("eevee");
    expect(eevee).toMatchObject({
      id: 133,
      name: "eevee",
      habitat: "urban",
      eggGroups: ["ground"],
      growthRate: "medium",
      baseHappiness: 70,
      captureRate: 45,
      generation: 1,
      evolutionChainId: 67,
      defaultPokemon: "eevee",
      legendary: false,
    });
  });
});

describe("pokemon", () => {
  it("reads types in slot order and base stats as a StatBlock", async () => {
    const zubat = await fixtureClient().pokemon("zubat");
    expect(zubat).toMatchObject({ types: ["poison", "flying"], baseStats: { hp: 40, atk: 45, def: 35, spa: 30, spd: 40, spe: 55 } });
  });
});

describe("evolution chain", () => {
  it("compacts links to species, details and evolvesTo", async () => {
    const chain = await fixtureClient().evolutionChain(64);
    expect(chain).toEqual({
      id: 64,
      chain: { species: "magikarp", details: [], evolvesTo: [{ species: "gyarados", details: [{ is_default: true, trigger: "level-up", min_level: 20 }], evolvesTo: [] }] },
    });
  });
});

describe("bundle", () => {
  it("fetches species, default pokemon and chain together from the fixtures", async () => {
    const bundle = await fixtureClient().bundle("pikachu");
    expect(bundle?.species.name).toBe("pikachu");
    expect(bundle?.pokemon?.types).toEqual(["electric"]);
    expect(bundle?.chain?.id).toBe(10);
  });
});

describe("cache", () => {
  it("writes each response under <endpoint>/<id>.json and never fetches it again", async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const bodies = { "pokemon/eevee": { id: 133, name: "eevee", types: [{ slot: 1, type: { name: "normal" } }], stats: [] } };
    const client = createPokeApiClient({ cacheDir: dir, fetch: fakeFetch(bodies, (u) => calls.push(u)), spacingMs: 0 });
    await client.pokemon("eevee");
    await client.pokemon("eevee");
    expect(calls).toEqual(["https://pokeapi.co/api/v2/pokemon/eevee/"]);
    expect(JSON.parse(await readFile(join(dir, "pokemon", "eevee.json"), "utf8"))).toEqual(bodies["pokemon/eevee"]);

    const offline = createPokeApiClient({ cacheDir: dir, fetch: noNetwork });
    expect((await offline.pokemon("eevee"))?.types).toEqual(["normal"]);
  });

  it("refresh bypasses the cache", async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const bodies = { "pokemon/eevee": { id: 133, name: "eevee", types: [], stats: [] } };
    await createPokeApiClient({ cacheDir: dir, fetch: fakeFetch(bodies, (u) => calls.push(u)), spacingMs: 0 }).pokemon("eevee");
    await createPokeApiClient({ cacheDir: dir, fetch: fakeFetch(bodies, (u) => calls.push(u)), spacingMs: 0, refresh: true }).pokemon("eevee");
    expect(calls).toHaveLength(2);
  });

  it("returns null for a species PokeAPI does not know and remembers that", async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const client = createPokeApiClient({ cacheDir: dir, fetch: fakeFetch({}, (u) => calls.push(u)), spacingMs: 0 });
    expect(await client.species("missingno")).toBeNull();
    expect(await client.bundle("missingno")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(await createPokeApiClient({ cacheDir: dir, fetch: noNetwork }).species("missingno")).toBeNull();
  });

  it("throws on other HTTP errors", async () => {
    const dir = await tempDir();
    const fetch: FetchLike = async () => ({ status: 500, ok: false, text: async () => "boom" });
    await expect(createPokeApiClient({ cacheDir: dir, fetch, spacingMs: 0 }).pokemon("eevee")).rejects.toBeInstanceOf(PokeApiError);
  });

  it("sends a User-Agent that names the project", async () => {
    const dir = await tempDir();
    let agent = "";
    const fetch: FetchLike = async (_url, init) => {
      agent = init.headers["User-Agent"];
      return { status: 404, ok: false, text: async () => "" };
    };
    await createPokeApiClient({ cacheDir: dir, fetch, spacingMs: 0 }).species("x");
    expect(agent).toMatch(/gotcha-pokedex/);
  });
});

describe("rate limit", () => {
  it("keeps at most maxInFlight requests open and spaces their starts", async () => {
    const dir = await tempDir();
    let open = 0;
    let peak = 0;
    const starts: number[] = [];
    const fetch: FetchLike = async () => {
      open++;
      peak = Math.max(peak, open);
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 30));
      open--;
      return { status: 404, ok: false, text: async () => "" };
    };
    const client = createPokeApiClient({ cacheDir: dir, fetch, maxInFlight: 2, spacingMs: 10 });
    await Promise.all(Array.from({ length: 6 }, (_, i) => client.species(`s${i}`)));
    expect(peak).toBeLessThanOrEqual(2);
    expect(client.requests).toBe(6);
    const sorted = [...starts].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(8);
  });

  it("collapses concurrent requests for the same key into one fetch", async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const client = createPokeApiClient({ cacheDir: dir, fetch: fakeFetch({}, (u) => calls.push(u)), spacingMs: 0 });
    await Promise.all([client.species("a"), client.species("a"), client.species("a")]);
    expect(calls).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("folds game text wraps into spaces", () => {
    expect(cleanFlavorText("Its genetic code\nis irregular.\x0cIt may mutate.")).toBe("Its genetic code is irregular. It may mutate.");
    expect(cleanFlavorText("It has the ability to alter the com­\nposition of its body")).toBe("It has the ability to alter the composition of its body");
  });

  it("reads the trailing id out of a PokeAPI url", () => {
    expect(idFromUrl("https://pokeapi.co/api/v2/evolution-chain/67/")).toBe(67);
    expect(idFromUrl("https://pokeapi.co/api/v2/generation/1")).toBe(1);
    expect(idFromUrl("nope")).toBeNull();
  });
});
