/**
 * Static audit of every extracted species: what the cache holds for each one
 * (model, bones, textures, cry, clips, particle and sound effects, locators,
 * poser coverage, locomotion) without opening a browser. Pairs with the
 * rendered pass in scripts/species-render-audit.py. Run:
 *   pnpm tsx scripts/species-audit.ts [out.json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.COBBLEMON_CACHE_DIR ?? path.resolve(".cobblemon-cache");
const out = process.argv[2] ?? path.join("test-results", "species-audit", "static.json");

interface Pose {
  poseTypes?: string[];
  animations?: unknown[];
  clips?: string[];
  quirks?: string[];
  isBattle?: boolean | string;
}
interface ClipSummary {
  length?: number;
  loop?: boolean | string;
  bones: number;
  molang: number;
  soundEffects?: string[];
}
interface Manifest {
  name: string;
  dex: number;
  aspects?: string[];
  forms?: unknown[];
  models?: Record<string, string>;
  textures?: Record<string, string>;
  sounds?: { cry?: { file: string }; ambient?: { file: string } };
  variations?: Array<{ aspects: string[]; model?: string; poser?: string; texture?: unknown; layers?: Array<{ name?: string; emissive?: boolean }> }>;
  posers?: Record<string, { file?: string; synthesized?: boolean; unresolvedClips?: string[]; poses?: Record<string, Pose>; animations?: Record<string, string> }>;
  animations?: Record<string, { file: string; clips: Record<string, ClipSummary> }>;
}

const IDLE = ["STAND", "NONE", "PORTRAIT", "PROFILE"];
const WALK = ["WALK"];
const SLEEP = ["SLEEP"];
const SWIM = ["SWIM"];
const FLY = ["FLY"];
const FLOAT = ["FLOAT"];
const HOVER = ["HOVER"];
const PROCEDURAL = /q\.(quadruped_walk|biped_walk|bimanual_swing|sine_wing_flap)/;

type Resolution = { kind: "clip"; clips: string[] } | { kind: "procedural"; expr: string[] } | { kind: "none" };

function resolve(poses: Record<string, Pose>, types: string[]): Resolution {
  const candidates = Object.values(poses).filter((p) => p.poseTypes?.some((t) => types.includes(t)));
  const overworld = candidates.filter((p) => !(p.isBattle === true || p.isBattle === "true"));
  for (const p of overworld.length ? overworld : candidates) {
    if (p.clips?.length) return { kind: "clip", clips: p.clips };
    const procedural = (p.animations ?? []).filter((a): a is string => typeof a === "string" && PROCEDURAL.test(a));
    if (procedural.length) return { kind: "procedural", expr: procedural };
  }
  return { kind: "none" };
}

interface ParticleRef {
  clip: string;
  at: number;
  effect: string;
  locator?: string;
}

function readParticles(file: string): { particles: ParticleRef[]; sounds: Record<string, string[]> } {
  const anim = JSON.parse(readFileSync(file, "utf8")) as { animations?: Record<string, { particle_effects?: Record<string, unknown>; sound_effects?: Record<string, unknown> }> };
  const particles: ParticleRef[] = [];
  const sounds: Record<string, string[]> = {};
  for (const [name, clip] of Object.entries(anim.animations ?? {})) {
    const short = name.replace(/^animation\./, "");
    for (const [t, v] of Object.entries(clip.particle_effects ?? {})) {
      for (const e of Array.isArray(v) ? v : [v]) {
        if (!e || typeof e !== "object") continue;
        const r = e as { effect?: string; locator?: string };
        if (r.effect) particles.push({ clip: short, at: parseFloat(t), effect: r.effect, locator: r.locator });
      }
    }
    for (const v of Object.values(clip.sound_effects ?? {})) {
      for (const e of Array.isArray(v) ? v : [v]) {
        const r = e as { effect?: string } | string;
        const effect = typeof r === "string" ? r : r?.effect;
        if (effect) (sounds[short] ??= []).push(effect);
      }
    }
  }
  return { particles, sounds };
}

function readGeometry(file: string): { bones: number; cubes: number; locators: string[]; textureSize: [number, number] } {
  const geo = JSON.parse(readFileSync(file, "utf8")) as {
    "minecraft:geometry": Array<{ description: { texture_width: number; texture_height: number }; bones?: Array<{ cubes?: unknown[]; locators?: Record<string, unknown> }> }>;
  };
  const g = geo["minecraft:geometry"][0];
  const bones = g.bones ?? [];
  return {
    bones: bones.length,
    cubes: bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0),
    locators: bones.flatMap((b) => Object.keys(b.locators ?? {})),
    textureSize: [g.description.texture_width, g.description.texture_height],
  };
}

const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as { species: Record<string, { name: string; dex: number }>; skipped: Record<string, string> };

const species: Record<string, unknown> = {};
for (const id of Object.keys(index.species).sort()) {
  const dir = path.join(root, id);
  const manifestFile = path.join(dir, "manifest.json");
  if (!existsSync(manifestFile)) continue;
  const m = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  const sp = JSON.parse(readFileSync(path.join(dir, "species.json"), "utf8")) as { baseScale?: number; behaviour?: { moving?: { walk?: Record<string, unknown>; swim?: Record<string, unknown>; fly?: Record<string, unknown> } } };
  const moving = sp.behaviour?.moving ?? {};
  const walk = moving.walk ?? {};
  const swim = moving.swim ?? {};
  const flies = moving.fly?.canFly === true;
  const swims = swim.canSwimInWater !== false && swim.avoidsWater !== true;
  const walks = walk.canWalk !== false && walk.avoidsLand !== true;

  const poserEntries = Object.entries(m.posers ?? {});
  const [poserName, poser] = poserEntries[0] ?? ["", undefined];
  const poses = poser?.poses ?? {};
  const usedClips = new Set<string>();
  for (const p of Object.values(poses)) {
    for (const c of p.clips ?? []) usedClips.add(c);
    for (const q of p.quirks ?? []) {
      const mm = /q\.bedrock_quirk\('([^']+)',\s*'([^']+)'/.exec(q);
      if (mm) usedClips.add(`${mm[1]}:${mm[2]}`);
    }
  }
  const named = poser?.animations ?? {};
  const oneShot = (key: string): string | undefined => {
    const expr = named[key];
    const mm = expr ? /q\.bedrock(?:_stateful)?\('([^']+)',\s*'([^']+)'/.exec(expr) : null;
    return mm ? `${mm[1]}:${mm[2]}` : undefined;
  };
  const cryClip = oneShot("cry");
  const faintClip = oneShot("faint");
  if (cryClip) usedClips.add(cryClip);
  if (faintClip) usedClips.add(faintClip);

  const clips: Record<string, ClipSummary & { group: string; used: boolean }> = {};
  const particles: ParticleRef[] = [];
  const sounds: Record<string, string[]> = {};
  for (const [group, g] of Object.entries(m.animations ?? {})) {
    for (const [name, c] of Object.entries(g.clips)) {
      clips[`${group}:${name}`] = { ...c, group, used: usedClips.has(`${group}:${name}`) };
    }
    const file = path.join(dir, g.file);
    if (existsSync(file)) {
      const r = readParticles(file);
      particles.push(...r.particles);
      Object.assign(sounds, r.sounds);
    }
  }

  const models: Record<string, ReturnType<typeof readGeometry>> = {};
  for (const [name, file] of Object.entries(m.models ?? {})) {
    const f = path.join(dir, file);
    if (existsSync(f)) models[name] = readGeometry(f);
  }

  const cryFile = m.sounds?.cry?.file ? path.join(dir, m.sounds.cry.file) : undefined;
  species[id] = {
    name: m.name,
    dex: m.dex,
    baseScale: sp.baseScale ?? 1,
    aspects: m.aspects ?? [],
    forms: (m.forms ?? []).length,
    variations: (m.variations ?? []).length,
    emissiveLayers: (m.variations ?? []).flatMap((v) => (v.layers ?? []).filter((l) => l.emissive).map((l) => l.name ?? "layer")),
    textures: Object.keys(m.textures ?? {}).length,
    models,
    cry: cryFile && existsSync(cryFile) ? "present" : "missing",
    ambientSound: Boolean(m.sounds?.ambient),
    locomotion: { walks: walks || (!swims && !flies), swims, flies, waterOnly: swims && walk.avoidsLand === true && !flies },
    poser: {
      name: poserName,
      synthesized: poser?.synthesized === true,
      unresolvedClips: poser?.unresolvedClips ?? [],
      idle: resolve(poses, IDLE),
      walk: resolve(poses, WALK),
      sleep: resolve(poses, SLEEP),
      swim: resolve(poses, SWIM),
      fly: resolve(poses, FLY),
      float: resolve(poses, FLOAT),
      hover: resolve(poses, HOVER),
      cry: cryClip,
      faint: faintClip,
      quirks: [...usedClips].filter((c) => /blink|quirk/.test(c)),
    },
    clips,
    unusedClips: Object.keys(clips).filter((c) => !clips[c].used),
    particles,
    sounds,
  };
}

const result = { generatedAt: new Date().toISOString(), cacheRoot: path.basename(root), total: Object.keys(species).length, skipped: index.skipped, species };
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`wrote ${out}: ${result.total} species`);
