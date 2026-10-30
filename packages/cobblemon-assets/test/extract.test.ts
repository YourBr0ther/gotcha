import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog";
import { formatCheck, readManifest } from "../src/check";
import { extractAll, readIndex, type ExtractResult } from "../src/extract";
import { JarReader } from "../src/jar";
import { ManifestSchema } from "../src/manifest";
import { buildStreamedJar } from "./build-jar";

let dir: string;
let jar: JarReader;
let out: string;
let result: ExtractResult;
const logged: string[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cobblemon-extract-"));
  await writeFile(join(dir, "cobblemon.jar"), buildStreamedJar());
  jar = JarReader.open(join(dir, "cobblemon.jar"));
  out = join(dir, "cache");
  result = await extractAll({ jar, catalog: buildCatalog(jar), outDir: out, log: (line) => logged.push(line) });
});
afterAll(async () => {
  jar.close();
  await rm(dir, { recursive: true, force: true });
});

describe("catalog", () => {
  it("indexes identifiers, sounds, lang and spawns", () => {
    const catalog = buildCatalog(jar);
    expect(catalog.cobblemonVersion).toBe("9.9.9+test");
    expect(catalog.models.get("cube_female.geo")).toMatch(/cube_female\.geo\.json$/);
    expect(catalog.posers.get("cube")).toMatch(/posers\/0001_cube\/cube\.json$/);
    expect(catalog.animations.get("block")).toMatch(/block\.animation\.json$/);
    expect(catalog.species.get("cube")?.resolverPaths).toHaveLength(2);
    expect(catalog.spawns.get("cube")).toHaveLength(2);
    expect(catalog.lang.has("item.cobblemon.poke_ball")).toBe(false);
    expect(catalog.sounds.get("pokemon.cube.cry")).toBeDefined();
  });
});

describe("extractAll", () => {
  it("extracts the implemented species and skips the rest with a reason", () => {
    expect(result.extracted).toEqual(["block", "cube"]);
    expect(result.skipped).toEqual({
      ghost: "species.json marks it not implemented",
      lost: "geometry missing: lost.geo",
      mute: "no animation file found",
    });
    expect(logged.some((l) => l.includes("skip lost"))).toBe(true);
  });

  it("writes the species folder with Cobblemon's files copied byte for byte", async () => {
    const files = (await readdir(join(out, "cube"), { recursive: true })).map((f) => f.split("\\").join("/")).sort();
    expect(files).toEqual(
      expect.arrayContaining([
        "animations/cube.animation.json",
        "dex.json",
        "license",
        "manifest.json",
        "models/cube.geo.json",
        "models/cube_female.geo.json",
        "posers/cube.json",
        "resolvers/0_cube_base.json",
        "resolvers/1_cube_female.json",
        "sounds/ambient.ogg",
        "sounds/cry.ogg",
        "spawn.json",
        "species.json",
        "textures/cube.png",
        "textures/cube_unreferenced.png",
        "textures/glow/cube_glow_1.png",
      ]),
    );
    const copied = await readFile(join(out, "cube", "animations", "cube.animation.json"));
    expect(copied).toEqual(Buffer.from(jar.read("assets/cobblemon/bedrock/pokemon/animations/0001_cube/cube.animation.json")));
    await expect(stat(join(out, "mute"))).rejects.toThrow();
  });

  it("writes a manifest that validates and resolves every reference", async () => {
    const manifest = ManifestSchema.parse(JSON.parse(await readFile(join(out, "cube", "manifest.json"), "utf8")));
    expect(manifest.dex).toBe(1);
    expect(manifest.models).toEqual({ cube: "models/cube.geo.json", cube_female: "models/cube_female.geo.json" });
    expect(Object.keys(manifest.animations.cube.clips).sort()).toEqual(["blink", "cry", "faint", "ground_idle", "ground_walk"]);
    expect(manifest.animations.cube.clips.ground_idle).toMatchObject({ length: 2, loop: true, bones: 2, molang: 2 });
    expect(manifest.animations.cube.clips.cry.soundEffects).toEqual(["pokemon.cube.cry"]);
    expect(manifest.animations.cube.clips.faint.loop).toBe("hold_on_last_frame");
    expect(manifest.aspects).toEqual(["alpha_eyes", "female", "glow", "shiny"]);
    expect(manifest.variations[0]).toEqual({ aspects: [], model: "models/cube.geo.json", poser: "posers/cube.json", texture: "textures/cube.png", layers: [] });
    expect(manifest.variations[2].layers?.[0]).toMatchObject({ name: "alpha_eyes", emissive: true, texture: "textures/cube_alpha.png" });
    expect(manifest.variations[3].layers?.[0].texture).toEqual({ fps: 8, frames: ["textures/glow/cube_glow_1.png", "textures/glow/cube_glow_2.png"], loop: true });
    expect(manifest.variations[4]).toEqual({ aspects: ["female"], model: "models/cube_female.geo.json" });
    expect(manifest.sounds.cry).toEqual({ event: "pokemon.cube.cry", file: "sounds/cry.ogg", volume: 0.8 });
    expect(manifest.sounds.ambient.file).toBe("sounds/ambient.ogg");
    expect(manifest.pokedex["cobblemon.species.cube.desc"]).toBe("A cube. It sits.");
    expect(manifest.pokedex["cobblemon.species.cube-gmax.desc"]).toBe("A bigger cube.");
    expect(manifest.forms).toEqual([{ name: "Gmax", aspects: ["gmax"] }]);
    expect(manifest.files).toEqual({ species: "species.json", dex: "dex.json", spawn: "spawn.json", license: "license", resolvers: ["resolvers/0_cube_base.json", "resolvers/1_cube_female.json"] });

    const poser = manifest.posers.cube;
    expect(poser.synthesized).toBe(false);
    expect(poser.rootBone).toBe("cube");
    expect(poser.animations.cry).toBe("q.bedrock_stateful('cube', 'cry')");
    expect(poser.poses.standing.isBattle).toBe(false);
    expect(poser.poses.standing.clips).toEqual(["cube:blink", "cube:ground_idle"]);
    expect(poser.poses.walking.animations).toEqual(["q.bedrock('cube', 'ground_walk')", { animation: "q.bedrock('cube', 'ground_idle')", condition: "q.is_ridden" }]);
    expect(poser.unresolvedClips).toEqual(["cube:missing_quirk", "cube:sleep"]);

    const spawn = JSON.parse(await readFile(join(out, "cube", "spawn.json"), "utf8"));
    expect(Object.keys(spawn).sort()).toEqual(["0001_cube.json", "herds/0001_cube_herd.json"]);
    const dex = JSON.parse(await readFile(join(out, "cube", "dex.json"), "utf8"));
    expect(dex.entries[0].speciesId).toBe("cobblemon:cube");
  });

  it("synthesizes a poser from clip names when Cobblemon ships none as JSON", async () => {
    const manifest = await readManifest(out, "block");
    const poser = manifest.posers.block;
    expect(poser.synthesized).toBe(true);
    expect(poser.file).toBeUndefined();
    expect(Object.keys(poser.poses).sort()).toEqual(["battle_standing", "floating", "hovering", "sleeping", "standing", "walking"]);
    expect(poser.poses.standing.animations).toEqual(["q.bedrock('block', 'ground_idle')"]);
    expect(poser.poses.walking.animations).toEqual(["q.bedrock('block', 'ground_idle')"]);
    expect(poser.poses.sleeping.animations).toEqual(["q.bedrock('block', 'sleep')"]);
    expect(poser.poses.battle_standing.isBattle).toBe(true);
    expect(poser.poses.standing.quirks).toEqual(["q.bedrock_quirk('block', 'blink')"]);
    expect(poser.animations).toEqual({ cry: "q.bedrock_stateful('block', 'cry')" });
    expect(poser.unresolvedClips).toEqual([]);
    expect(await stat(join(out, "block", "sounds", "cry.ogg"))).toBeTruthy();
    expect(manifest.files.dex).toBeUndefined();
  });

  it("writes an index with a hash per species that is stable across runs", async () => {
    const first = await readIndex(out);
    expect(first).not.toBeNull();
    expect(Object.keys(first!.species)).toEqual(["block", "cube"]);
    expect(first!.species.cube.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first!.species.cube.files).toBeGreaterThan(10);
    expect(first!.skipped).toEqual(result.skipped);
    expect(first!.jarSha256).toMatch(/^[0-9a-f]{64}$/);

    const again = await extractAll({ jar, catalog: buildCatalog(jar), outDir: out });
    expect(again.index).toEqual(first);
    expect(await readFile(join(out, "index.json"), "utf8")).toBe(await readFile(join(out, "index.json"), "utf8"));
  });

  it("keeps the index consistent on a filtered run and changes the hash when a file changes", async () => {
    const before = (await readIndex(out))!;
    await writeFile(join(out, "cube", "textures", "cube.png"), "tampered");
    const filtered = await extractAll({ jar, catalog: buildCatalog(jar), outDir: out, only: ["block", "ghost"] });
    expect(filtered.extracted).toEqual(["block"]);
    expect(filtered.index.species.cube.hash).not.toBe(before.species.cube.hash);
    expect(filtered.index.species.block.hash).toBe(before.species.block.hash);
    expect(filtered.index.skipped).toEqual(before.skipped);
    const restored = await extractAll({ jar, catalog: buildCatalog(jar), outDir: out, only: ["cube"] });
    expect(restored.index.species.cube.hash).toBe(before.species.cube.hash);
  });
});

describe("check", () => {
  it("prints clips, poses, aspects and texture variants", async () => {
    const text = formatCheck(await readManifest(out, "cube"));
    expect(text).toContain("Cube (#1, cube) from Cobblemon 9.9.9+test");
    expect(text).toMatch(/ground_idle\s+2s, loop, 2 bones, 2 molang/);
    expect(text).toMatch(/cry\s+1.2s, once, 1 bones, sound pokemon.cube.cry/);
    expect(text).toContain("q.bedrock('cube', 'ground_idle')  if q.is_ridden");
    expect(text).toContain("unresolved clips: cube:missing_quirk, cube:sleep");
    expect(text).toContain("aspects  alpha_eyes, female, glow, shiny");
    expect(text).toContain("glow: layer glow animated 8fps [textures/glow/cube_glow_1.png, textures/glow/cube_glow_2.png] (emissive)");
    expect(text).toMatch(/cube_unreferenced.png\s+unreferenced/);
    expect(text).toMatch(/cube_shiny.png\s+shiny/);
    expect(text).toMatch(/cry\s+sounds\/cry.ogg\s+pokemon.cube.cry\s+volume 0.8/);
    const synthesized = formatCheck(await readManifest(out, "block"));
    expect(synthesized).toContain("(synthesized from clip names; Cobblemon ships this poser as code)");
  });

  it("explains a species that was never extracted", async () => {
    await expect(readManifest(out, "ghost")).rejects.toThrow(/run `pnpm assets:extract`/);
  });
});
