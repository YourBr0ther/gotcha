import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import { collectParticleReferences, effectsInClip, extractParticles, indexParticleDefinitions, type ParticleJar, resolveParticleTexture } from "./particles";

/** An in-memory jar: path to JSON value or bytes. Synthetic throughout; no Cobblemon asset is reproduced. */
function fakeJar(files: Record<string, unknown>): ParticleJar {
  const bytes = (path: string): Uint8Array => {
    const value = files[path];
    if (value === undefined) throw new Error(`jar entry not found: ${path}`);
    return value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
  };
  return {
    names: (prefix = "") => Object.keys(files).filter((name) => name.startsWith(prefix)),
    has: (name) => name in files,
    read: bytes,
    readJson: <T>(name: string) => JSON.parse(new TextDecoder().decode(bytes(name))) as T,
  };
}

function definition(identifier: string, texture: string, extra: Record<string, unknown> = {}) {
  return {
    format_version: "1.10.0",
    particle_effect: {
      description: { identifier, basic_render_parameters: { material: "particles_alpha", texture } },
      components: { "minecraft:emitter_rate_instant": { num_particles: 1 }, ...extra },
    },
  };
}

const animations = {
  "assets/cobblemon/bedrock/pokemon/animations/0001_puff/puff.animation.json": {
    animations: {
      "animation.puff.ground_idle": { loop: true, particle_effects: { "0.0": [{ effect: "puff_smoke", locator: "gas" }, { effect: "puff_smoke", locator: "gas" }] } },
      "animation.puff.faint": { particle_effects: { "1.5": { effect: "cobblemon:sparks" }, "0.25": "cobblemon:puff_bubble_handler", "2.0": "" } },
      "animation.puff.blink": {},
    },
  },
};

const jarFiles: Record<string, unknown> = {
  ...animations,
  "assets/cobblemon/bedrock/particles/pokemon/puff/puff_smoke.particle.json": definition("cobblemon:puff_smoke", "textures/particles/generic/smoke/smoke"),
  // No `.particle` infix, like the jar's spewpa confetti: matched on identifier.
  "assets/cobblemon/bedrock/particles/misc/odd_name.json": definition("cobblemon:sparks", "textures/blocks/wool_colored_white"),
  "assets/cobblemon/bedrock/particles/unused.particle.json": definition("cobblemon:unused", "textures/particles/generic/white"),
  "assets/cobblemon/textures/particle/generic/smoke/smoke.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  "assets/cobblemon/textures/particle/generic/white.png": new Uint8Array([1]),
};

const catalog = {
  cobblemonVersion: "0.0.0-test",
  animations: new Map([["puff", "assets/cobblemon/bedrock/pokemon/animations/0001_puff/puff.animation.json"]]),
} as unknown as Catalog;

describe("effectsInClip", () => {
  it("reads object, array and string entries in keyframe order, dropping namespaces and empties", () => {
    expect(effectsInClip(animations["assets/cobblemon/bedrock/pokemon/animations/0001_puff/puff.animation.json"].animations["animation.puff.faint"].particle_effects)).toEqual([
      "puff_bubble_handler",
      "sparks",
    ]);
    expect(effectsInClip(undefined)).toEqual([]);
    expect(effectsInClip({ "0.0": { locator: "gas" } })).toEqual([]);
  });
});

describe("collectParticleReferences", () => {
  it("lists every effect with one clip that fires it", () => {
    const refs = collectParticleReferences(fakeJar(jarFiles), catalog);
    expect([...refs.keys()].sort()).toEqual(["puff_bubble_handler", "puff_smoke", "sparks"]);
    expect(refs.get("puff_smoke")?.clip).toBe("puff:ground_idle");
    expect(refs.get("sparks")?.clip).toBe("puff:faint");
  });
});

describe("indexParticleDefinitions and resolveParticleTexture", () => {
  it("keys definitions by identifier, not filename, and maps textures/particles to the jar's textures/particle", () => {
    const jar = fakeJar(jarFiles);
    const defs = indexParticleDefinitions(jar);
    expect(defs.get("sparks")?.jarPath).toBe("assets/cobblemon/bedrock/particles/misc/odd_name.json");
    expect(defs.get("puff_smoke")?.texture).toBe("textures/particles/generic/smoke/smoke");
    expect(resolveParticleTexture(jar, "textures/particles/generic/smoke/smoke")).toBe("assets/cobblemon/textures/particle/generic/smoke/smoke.png");
    expect(resolveParticleTexture(jar, "textures/particle/generic/white")).toBe("assets/cobblemon/textures/particle/generic/white.png");
    expect(resolveParticleTexture(jar, "textures/blocks/wool_colored_white")).toBeNull();
    expect(resolveParticleTexture(jar, undefined)).toBeNull();
  });
});

describe("extractParticles", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes only the referenced definitions, their textures and an index, and leaves the rest of the cache alone", async () => {
    dir = await mkdtemp(join(os.tmpdir(), "gotcha-particles-"));
    const index = await extractParticles({ jar: fakeJar(jarFiles), catalog, outDir: dir });

    expect(Object.keys(index.effects).sort()).toEqual(["puff_smoke", "sparks"]);
    expect(index.effects.puff_smoke).toEqual({ file: "puff_smoke.json", texture: "textures/generic/smoke/smoke.png", material: "particles_alpha", clip: "puff:ground_idle" });
    expect(index.effects.sparks.texture).toBeNull();
    expect(index.skipped.puff_bubble_handler).toContain("handler");
    expect(index.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const written = JSON.parse(await readFile(join(dir, "particles", "index.json"), "utf8"));
    expect(written.effects).toEqual(index.effects);
    expect(await readFile(join(dir, "particles", "textures", "generic", "smoke", "smoke.png"))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await expect(stat(join(dir, "particles", "unused.json"))).rejects.toThrow();
    // The species index is not this step's to write.
    await expect(stat(join(dir, "index.json"))).rejects.toThrow();
  });
});
