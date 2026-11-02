import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Which species animate well enough is pack data (see services/animation); the fake cache here has no posers.
vi.mock("@/lib/services/animation", () => ({ pickableSpecies: async () => new Set(["eevee"]) }));

let dir: string;
let previous: string | undefined;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "gotcha-assets-"));
  const cache = path.join(dir, "cobblemon-cache");
  await mkdir(path.join(cache, "eevee", "textures"), { recursive: true });
  await writeFile(
    path.join(cache, "index.json"),
    JSON.stringify({ format: 1, species: { eevee: { hash: "sha256:6ec83e50606812f5abcdef", name: "Eevee", dex: 133 } } }),
  );
  await writeFile(path.join(cache, "eevee", "manifest.json"), JSON.stringify({ species: "eevee" }));
  await writeFile(path.join(cache, "eevee", "textures", "eevee.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(cache, "eevee", "notes.txt"), "secret");
  await mkdir(path.join(cache, "particles", "textures"), { recursive: true });
  await writeFile(
    path.join(cache, "particles", "index.json"),
    JSON.stringify({ format: 1, hash: "sha256:9c11af14067f7f23abcdef", effects: { puff_smoke: { file: "puff_smoke.json", texture: "textures/smoke.png" } } }),
  );
  await writeFile(path.join(cache, "particles", "puff_smoke.json"), JSON.stringify({ particle_effect: {} }));
  await writeFile(path.join(cache, "particles", "textures", "smoke.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(dir, "outside.json"), "{}");
  const pokedex = path.join(dir, "pokedex-cache", "species");
  await mkdir(pokedex, { recursive: true });
  await writeFile(
    path.join(pokedex, "index.json"),
    JSON.stringify({ species: { eevee: { dioramas: ["meadow", "forest"] }, onix: { dioramas: ["cave"] } } }),
  );
  await writeFile(
    path.join(cache, "eevee", "species.json"),
    JSON.stringify({ baseScale: 0.5, behaviour: { moving: { swim: { avoidsWater: true } } } }),
  );
  previous = process.env.GOTCHA_DATA_DIR;
  process.env.GOTCHA_DATA_DIR = dir;
});

afterAll(() => {
  if (previous === undefined) delete process.env.GOTCHA_DATA_DIR;
  else process.env.GOTCHA_DATA_DIR = previous;
});

async function get(species: string, parts: string[], query = "") {
  const { GET } = await import("./[species]/[...path]/route");
  const req = new Request(`http://test/api/assets/${species}/${parts.join("/")}${query}`);
  return GET(req, { params: Promise.resolve({ species, path: parts }) });
}

describe("asset route", () => {
  it("serves json and png from GOTCHA_DATA_DIR/cobblemon-cache with the right types", async () => {
    const json = await get("eevee", ["manifest.json"]);
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toBe("application/json");
    expect(await json.json()).toEqual({ species: "eevee" });
    const png = await get("eevee", ["textures", "eevee.png"]);
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-length")).toBe("4");
  });

  it("is immutable only when the version matches the species hash", async () => {
    const stale = await get("eevee", ["manifest.json"]);
    expect(stale.headers.get("cache-control")).toContain("must-revalidate");
    const fresh = await get("eevee", ["manifest.json"], "?v=6ec83e50606812f5");
    expect(fresh.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(fresh.headers.get("etag")).toBe('"6ec83e50606812f5"');
    const wrong = await get("eevee", ["manifest.json"], "?v=deadbeef");
    expect(wrong.headers.get("cache-control")).toContain("must-revalidate");
  });

  it("refuses other file types, traversal and odd species ids", async () => {
    expect((await get("eevee", ["notes.txt"])).status).toBe(404);
    expect((await get("eevee", ["..", "outside.json"])).status).toBe(404);
    expect((await get("..", ["outside.json"])).status).toBe(404);
    expect((await get("eevee", ["..", "..", "outside.json"])).status).toBe(404);
    expect((await get("eevee", ["missing.json"])).status).toBe(404);
    expect((await get("ee vee", ["manifest.json"])).status).toBe(404);
  });

  it("lists species with short versions at /api/assets/index, and the particle folder's version", async () => {
    const { GET } = await import("./index/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { species: Record<string, { v: string }>; particles?: { v: string } };
    expect(body.species.eevee.v).toBe("6ec83e50606812f5");
    expect(body.particles).toEqual({ v: "9c11af14067f7f23" });
  });

  it("serves the particle folder under its own version", async () => {
    const def = await get("particles", ["puff_smoke.json"], "?v=9c11af14067f7f23");
    expect(def.status).toBe(200);
    expect(def.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(def.headers.get("etag")).toBe('"9c11af14067f7f23"');
    const png = await get("particles", ["textures", "smoke.png"]);
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("cache-control")).toContain("must-revalidate");
    expect((await get("particles", ["..", "eevee", "manifest.json"])).status).toBe(404);
  });

  it("names small species that prefer a diorama as ambient candidates", async () => {
    const { GET } = await import("./ambient/route");
    const res = await GET(new Request("http://test/api/assets/ambient?diorama=forest"));
    const body = (await res.json()) as { candidates: Array<{ species: string; walks: boolean; swims: boolean }> };
    expect(body.candidates).toEqual([{ species: "eevee", baseScale: 0.5, flies: false, swims: false, walks: true }]);
    const cave = await GET(new Request("http://test/api/assets/ambient?diorama=cave"));
    expect(((await cave.json()) as { candidates: unknown[] }).candidates).toEqual([]);
    expect((await GET(new Request("http://test/api/assets/ambient?diorama=moon"))).status).toBe(400);
  });
});
