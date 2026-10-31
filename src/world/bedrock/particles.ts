/**
 * Bedrock particle effects, the subset Cobblemon's pokemon animations use.
 *
 * A `.particle.json` is a bag of components. The parser here reads the ones
 * that matter for an overworld creature (steady, instant, once, looping and
 * expression emitters; point, sphere, disc and box shapes; billboards with a
 * flipbook or a static UV rectangle; constant or gradient tint; initial
 * speed and spin; dynamic motion with acceleration and drag; linear curves)
 * and logs once per component it ignores. Collision, events and parametric
 * motion are out: nothing a pokemon fires in the overworld needs them to
 * read right.
 *
 * Every particle of one creature draws in at most two calls: one instanced
 * quad mesh per blend mode (alpha, additive), all effects sharing an atlas
 * the texture step packs at load. Instanced quads rather than Points,
 * because gl_PointSize has a platform cap (64 on some phones) and Gastly's
 * smoke is a block wide at arm's length.
 *
 * Units are blocks, as in the definitions. `size` is a half-extent
 * (SIZE_TO_WIDTH = 2), the convention of Minecraft's Particle.quadSize and
 * of Snowstorm's emulator. It was tried as a full width first because
 * Gastly's cloud looked enormous against the phone framing; at full width
 * Slugma's bubbles (0.2 at scale 0.7) vanished into the texels and the
 * cherry petals (0.05) were a pixel, so the cloud is simply big, as it is
 * in the mod.
 *
 * Nothing here needs a WebGL context: the geometry, material and simulation
 * build and tick under node, which is how the tests run.
 */

import * as THREE from "three";
import { evaluateMolang, type MolangContext, MolangUnsupported, warnOnce } from "./molang";
import type { BedrockAnimation, BedrockAnimationFile, BedrockParticleKeyframe } from "./types";

/** One effect a clip fires: when, which, and from where. */
export interface ParticleKeyframe {
  time: number;
  effect: string;
  locator?: string;
}

/** Effects ending in `_handler` are Kotlin in the mod (Krabby's bubbles); there is no definition to draw. */
export function isHandlerEffect(effect: string): boolean {
  return effect.endsWith("_handler");
}

function keyframeEntries(value: BedrockParticleKeyframe): Array<{ effect: string; locator?: string }> {
  const out: Array<{ effect: string; locator?: string }> = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry === "string") {
      if (entry) out.push({ effect: stripNamespace(entry) });
    } else if (entry && typeof entry.effect === "string" && entry.effect) {
      out.push({ effect: stripNamespace(entry.effect), locator: entry.locator });
    }
  }
  return out;
}

/** A clip's particle keyframes in time order; empty for a clip without any. */
export function clipParticleKeyframes(anim: BedrockAnimation | undefined): ParticleKeyframe[] {
  const out: ParticleKeyframe[] = [];
  for (const [key, value] of Object.entries(anim?.particle_effects ?? {})) {
    const time = parseFloat(key);
    if (!Number.isFinite(time)) continue;
    for (const entry of keyframeEntries(value)) out.push({ time, ...entry });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Every drawable effect id an animation file names, so the bundle loader knows what to fetch. */
export function effectsInAnimationFile(file: BedrockAnimationFile): string[] {
  const ids = new Set<string>();
  for (const anim of Object.values(file.animations ?? {})) {
    for (const k of clipParticleKeyframes(anim)) if (!isHandlerEffect(k.effect)) ids.add(k.effect);
  }
  return [...ids].sort();
}

export type Expr = number | string;
export type Expr3 = [Expr, Expr, Expr];
export type Rgba = [number, number, number, number];

export interface ParticleDefinitionFile {
  format_version?: string;
  particle_effect: {
    description: {
      identifier: string;
      basic_render_parameters?: { material?: string; texture?: string };
    };
    components?: Record<string, unknown>;
    curves?: Record<string, unknown>;
    events?: unknown;
  };
}

export type Blend = "alpha" | "additive";

export type EmitterRate = { kind: "instant"; count: Expr } | { kind: "steady"; rate: Expr; max: Expr };

export type EmitterLifetime =
  | { kind: "once"; activeTime: Expr }
  | { kind: "looping"; activeTime: Expr; sleepTime: Expr }
  | { kind: "expression"; activation: Expr; expiration: Expr };

/** Where a new particle heads: toward or away from the shape's centre, a fixed vector, or (null) anywhere. */
export type Direction = "inwards" | "outwards" | Expr3 | null;

export type EmitterShape =
  | { kind: "point"; offset: Expr3; direction: Direction }
  | { kind: "sphere"; offset: Expr3; radius: Expr; surfaceOnly: boolean; direction: Direction }
  | { kind: "disc"; offset: Expr3; radius: Expr; normal: Expr3; surfaceOnly: boolean; direction: Direction }
  | { kind: "box"; offset: Expr3; half: Expr3; surfaceOnly: boolean; direction: Direction };

export interface Flipbook {
  base: [Expr, Expr];
  size: [Expr, Expr];
  step: [Expr, Expr];
  fps: Expr;
  /** Frames in the strip; null means as many as the texture holds along the step. */
  maxFrame: Expr | null;
  stretchToLifetime: boolean;
  loop: boolean;
}

export type BillboardUv = { kind: "static"; uv: [Expr, Expr]; uvSize: [Expr, Expr] } | ({ kind: "flipbook" } & Flipbook);

export interface Billboard {
  /** Half extents in blocks. */
  size: [Expr, Expr];
  textureWidth: number;
  textureHeight: number;
  uv: BillboardUv;
}

export interface GradientStop {
  t: number;
  /** Linear-light RGBA. */
  color: Rgba;
}

export type Tint = { kind: "constant"; color: [Expr, Expr, Expr, Expr] } | { kind: "gradient"; stops: GradientStop[]; interpolant: Expr };

export interface Curve {
  /** Variable it writes, without the `variable.` prefix. */
  name: string;
  input: Expr;
  range: Expr;
  /** Evenly spaced over [0, range], or keyed by input value. */
  nodes: number[] | Array<{ t: number; value: number }>;
}

export interface ParsedEffect {
  id: string;
  material: string;
  blend: Blend;
  rate: EmitterRate;
  lifetime: EmitterLifetime;
  shape: EmitterShape;
  billboard: Billboard;
  tint: Tint;
  initialSpeed: Expr | Expr3;
  spin: { rotation: Expr; rate: Expr };
  maxLifetime: Expr;
  dynamic: { acceleration: Expr3; drag: Expr; rotationAcceleration: Expr; rotationDrag: Expr };
  curves: Curve[];
  /** `cobblemon:emitter_space.scaling: entity`: offsets, speeds and sizes follow the creature's scale. */
  entityScaling: boolean;
  /** Particles ride along with the locator instead of staying where they were born. */
  local: boolean;
  /** Molang statements run once when the emitter starts, and every frame. */
  creation: string | null;
  perUpdate: string | null;
}

export const SIZE_TO_WIDTH = 2;
/** Live particles one blend mode can hold per creature; spawns past it are dropped. */
export const POOL_CAPACITY = 256;

const KNOWN_NOOP = new Set(["minecraft:particle_appearance_lighting"]);

/** sRGB component to linear light; three's shader does the reverse on the way out. */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

function stripNamespace(id: string): string {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function expr(v: unknown, fallback: Expr): Expr {
  if (typeof v === "number" || typeof v === "string") return v;
  return fallback;
}

function expr3(v: unknown, fallback: Expr3): Expr3 {
  if (Array.isArray(v)) return [expr(v[0], fallback[0]), expr(v[1], fallback[1]), expr(v[2], fallback[2])];
  if (typeof v === "number" || typeof v === "string") return [v, v, v];
  return fallback;
}

function expr2(v: unknown, fallback: [Expr, Expr]): [Expr, Expr] {
  if (Array.isArray(v)) return [expr(v[0], fallback[0]), expr(v[1], fallback[1])];
  if (typeof v === "number" || typeof v === "string") return [v, v];
  return fallback;
}

function direction(v: unknown): Direction {
  if (v === "inwards" || v === "outwards") return v;
  if (Array.isArray(v)) return expr3(v, [0, 0, 0]);
  return null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const ZERO3: Expr3 = [0, 0, 0];

/** `#AARRGGBB` / `#RRGGBB`, or `[r, g, b, a?]` in 0..1 sRGB, to linear-light RGBA. */
export function parseColor(v: unknown): Rgba | null {
  if (typeof v === "string" && v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = parseInt(hex, 16);
    if (!Number.isFinite(n)) return null;
    const a = hex.length === 8 ? ((n >>> 24) & 0xff) / 255 : 1;
    return [srgbToLinear(((n >>> 16) & 0xff) / 255), srgbToLinear(((n >>> 8) & 0xff) / 255), srgbToLinear((n & 0xff) / 255), a];
  }
  if (Array.isArray(v) && v.every((c) => typeof c === "number")) {
    return [srgbToLinear(v[0] ?? 1), srgbToLinear(v[1] ?? 1), srgbToLinear(v[2] ?? 1), v[3] ?? 1];
  }
  return null;
}

function parseTint(v: unknown): Tint {
  const color = obj(v).color;
  if (color && typeof color === "object" && !Array.isArray(color)) {
    const spec = color as { gradient?: unknown; interpolant?: unknown };
    const stops: GradientStop[] = [];
    if (Array.isArray(spec.gradient)) {
      spec.gradient.forEach((c, i, all) => {
        const rgba = parseColor(c);
        if (rgba) stops.push({ t: all.length > 1 ? i / (all.length - 1) : 0, color: rgba });
      });
    } else {
      for (const [key, c] of Object.entries(obj(spec.gradient))) {
        const t = parseFloat(key);
        const rgba = parseColor(c);
        if (Number.isFinite(t) && rgba) stops.push({ t, color: rgba });
      }
    }
    stops.sort((a, b) => a.t - b.t);
    if (stops.length === 0) stops.push({ t: 0, color: [1, 1, 1, 1] });
    return { kind: "gradient", stops, interpolant: expr(spec.interpolant, 0) };
  }
  if (typeof color === "string") {
    const rgba = parseColor(color) ?? [1, 1, 1, 1];
    return { kind: "constant", color: rgba };
  }
  if (Array.isArray(color)) {
    const parts = color as unknown[];
    const toLinear = (c: unknown): Expr => (typeof c === "number" ? srgbToLinear(c) : expr(c, 1));
    return { kind: "constant", color: [toLinear(parts[0]), toLinear(parts[1]), toLinear(parts[2]), expr(parts[3], 1)] };
  }
  return { kind: "constant", color: [1, 1, 1, 1] };
}

function parseShape(name: string, v: unknown): EmitterShape {
  const o = obj(v);
  const offset = expr3(o.offset, ZERO3);
  const dir = direction(o.direction);
  const surfaceOnly = o.surface_only === true;
  switch (name) {
    case "minecraft:emitter_shape_sphere":
      return { kind: "sphere", offset, radius: expr(o.radius, 1), surfaceOnly, direction: dir };
    case "minecraft:emitter_shape_disc":
      return { kind: "disc", offset, radius: expr(o.radius, 1), normal: expr3(o.plane_normal, [0, 1, 0]), surfaceOnly, direction: dir };
    case "minecraft:emitter_shape_box":
      return { kind: "box", offset, half: expr3(o.half_dimensions, ZERO3), surfaceOnly, direction: dir };
    default:
      return { kind: "point", offset, direction: dir };
  }
}

function parseBillboard(v: unknown): Billboard {
  const o = obj(v);
  const uvSpec = obj(o.uv);
  const textureWidth = num(uvSpec.texture_width, 16);
  const textureHeight = num(uvSpec.texture_height, 16);
  let uv: BillboardUv;
  if (uvSpec.flipbook && typeof uvSpec.flipbook === "object") {
    const f = obj(uvSpec.flipbook);
    uv = {
      kind: "flipbook",
      base: expr2(f.base_UV, [0, 0]),
      size: expr2(f.size_UV, [textureWidth, textureHeight]),
      step: expr2(f.step_UV, [0, 0]),
      fps: expr(f.frames_per_second, 1),
      maxFrame: f.max_frame === undefined ? null : expr(f.max_frame, 1),
      stretchToLifetime: f.stretch_to_lifetime === true,
      loop: f.loop === true,
    };
  } else {
    uv = { kind: "static", uv: expr2(uvSpec.uv, [0, 0]), uvSize: expr2(uvSpec.uv_size, [textureWidth, textureHeight]) };
  }
  return { size: expr2(o.size, [0.1, 0.1]), textureWidth, textureHeight, uv };
}

function parseCurves(v: unknown): Curve[] {
  const out: Curve[] = [];
  for (const [rawName, spec] of Object.entries(obj(v))) {
    const o = obj(spec);
    const name = rawName.replace(/^(variable|v|temp|t)\./i, "").toLowerCase();
    const type = typeof o.type === "string" ? o.type : "linear";
    if (type !== "linear" && type !== "bezier_chain") warnOnce(`curve:${type}`, `particle curve type ${type} read as linear`);
    let nodes: Curve["nodes"];
    if (Array.isArray(o.nodes)) nodes = o.nodes.map((n) => num(n, 0));
    else {
      nodes = Object.entries(obj(o.nodes))
        .map(([key, node]) => ({ t: parseFloat(key), value: num(obj(node).value, 0) }))
        .filter((n) => Number.isFinite(n.t))
        .sort((a, b) => a.t - b.t);
    }
    out.push({ name, input: expr(o.input, 0), range: expr(o.horizontal_range, 1), nodes });
  }
  return out;
}

/** Read a definition file into the shape the simulation runs. Never throws on a strange file: every piece has a default. */
export function parseParticleDefinition(file: ParticleDefinitionFile): ParsedEffect {
  const effect = file.particle_effect;
  const id = stripNamespace(effect.description.identifier);
  const material = effect.description.basic_render_parameters?.material ?? "particles_alpha";
  const components = obj(effect.components);
  const out: ParsedEffect = {
    id,
    material,
    blend: material === "particles_add" ? "additive" : "alpha",
    rate: { kind: "instant", count: 1 },
    lifetime: { kind: "once", activeTime: 1 },
    shape: { kind: "point", offset: ZERO3, direction: null },
    billboard: parseBillboard(undefined),
    tint: { kind: "constant", color: [1, 1, 1, 1] },
    initialSpeed: 0,
    spin: { rotation: 0, rate: 0 },
    maxLifetime: 1,
    dynamic: { acceleration: ZERO3, drag: 0, rotationAcceleration: 0, rotationDrag: 0 },
    curves: parseCurves(effect.curves),
    entityScaling: false,
    local: false,
    creation: null,
    perUpdate: null,
  };
  for (const [name, value] of Object.entries(components)) {
    const o = obj(value);
    switch (name) {
      case "cobblemon:emitter_space":
        out.entityScaling = o.scaling === "entity";
        break;
      case "minecraft:emitter_initialization":
        out.creation = typeof o.creation_expression === "string" ? o.creation_expression : null;
        out.perUpdate = typeof o.per_update_expression === "string" ? o.per_update_expression : null;
        break;
      case "minecraft:emitter_local_space":
        out.local = o.position === true || o.rotation === true;
        break;
      case "minecraft:emitter_rate_instant":
        out.rate = { kind: "instant", count: expr(o.num_particles, 10) };
        break;
      case "minecraft:emitter_rate_steady":
        out.rate = { kind: "steady", rate: expr(o.spawn_rate, 1), max: expr(o.max_particles, 50) };
        break;
      case "minecraft:emitter_lifetime_once":
        out.lifetime = { kind: "once", activeTime: expr(o.active_time, 10) };
        break;
      case "minecraft:emitter_lifetime_looping":
        out.lifetime = { kind: "looping", activeTime: expr(o.active_time, 10), sleepTime: expr(o.sleep_time, 0) };
        break;
      case "minecraft:emitter_lifetime_expression":
        out.lifetime = { kind: "expression", activation: expr(o.activation_expression, 1), expiration: expr(o.expiration_expression, 0) };
        break;
      case "minecraft:emitter_shape_point":
      case "minecraft:emitter_shape_sphere":
      case "minecraft:emitter_shape_disc":
      case "minecraft:emitter_shape_box":
        out.shape = parseShape(name, value);
        break;
      case "minecraft:particle_appearance_billboard":
        out.billboard = parseBillboard(value);
        break;
      case "minecraft:particle_appearance_tinting":
        out.tint = parseTint(value);
        break;
      case "minecraft:particle_initial_speed":
        out.initialSpeed = Array.isArray(value) ? expr3(value, ZERO3) : expr(value, 0);
        break;
      case "minecraft:particle_initial_spin":
        out.spin = { rotation: expr(o.rotation, 0), rate: expr(o.rotation_rate, 0) };
        break;
      case "minecraft:particle_lifetime_expression":
        out.maxLifetime = expr(o.max_lifetime, 1);
        break;
      case "minecraft:particle_motion_dynamic":
        out.dynamic = {
          acceleration: expr3(o.linear_acceleration, ZERO3),
          drag: expr(o.linear_drag_coefficient, 0),
          rotationAcceleration: expr(o.rotation_acceleration, 0),
          rotationDrag: expr(o.rotation_drag_coefficient, 0),
        };
        break;
      default:
        if (!KNOWN_NOOP.has(name)) warnOnce(`particle:${name}`, `particle component ${name} is not implemented; ignored (first seen in ${id})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation helpers, pure.
// ---------------------------------------------------------------------------

export interface EvalContext extends MolangContext {
  vars: Record<string, number>;
}

export function ev(e: Expr, ctx: EvalContext): number {
  if (typeof e === "number") return e;
  try {
    const v = evaluateMolang(e, ctx);
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    if (err instanceof MolangUnsupported) {
      warnOnce(e, `${err.message}; using 0`);
      return 0;
    }
    throw err;
  }
}

/**
 * Run `v.x = expr; v.y = expr;` statements (emitter initialization). A
 * statement without an assignment is evaluated for nothing; `q.*` calls
 * that the interpreter lacks degrade to one warning like any keyframe.
 */
export function runMolangScript(src: string, ctx: EvalContext): void {
  for (const raw of src.split(";")) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const m = /^(?:v|variable|t|temp)\.([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]+)$/.exec(stmt);
    if (m) ctx.vars[m[1].toLowerCase()] = ev(m[2], ctx);
    else ev(stmt, ctx);
  }
}

export function evalCurve(curve: Curve, ctx: EvalContext): number {
  const nodes = curve.nodes;
  if (nodes.length === 0) return 0;
  const input = ev(curve.input, ctx);
  if (typeof nodes[0] === "number") {
    const values = nodes as number[];
    if (values.length === 1) return values[0];
    const range = ev(curve.range, ctx);
    const t = range !== 0 ? Math.min(1, Math.max(0, input / range)) : 0;
    const pos = t * (values.length - 1);
    const i = Math.min(values.length - 2, Math.floor(pos));
    return values[i] + (values[i + 1] - values[i]) * (pos - i);
  }
  const keyed = nodes as Array<{ t: number; value: number }>;
  if (input <= keyed[0].t) return keyed[0].value;
  const last = keyed[keyed.length - 1];
  if (input >= last.t) return last.value;
  let i = 0;
  while (i < keyed.length - 2 && keyed[i + 1].t <= input) i++;
  const a = keyed[i];
  const b = keyed[i + 1];
  const span = b.t - a.t;
  return span > 0 ? a.value + (b.value - a.value) * ((input - a.t) / span) : b.value;
}

export function sampleGradient(stops: GradientStop[], t: number, out: Rgba): Rgba {
  if (t <= stops[0].t || stops.length === 1) {
    const c = stops[0].color;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    out[3] = c[3];
    return out;
  }
  const last = stops[stops.length - 1];
  if (t >= last.t) {
    out[0] = last.color[0];
    out[1] = last.color[1];
    out[2] = last.color[2];
    out[3] = last.color[3];
    return out;
  }
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1].t <= t) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 1;
  for (let c = 0; c < 4; c++) out[c] = a.color[c] + (b.color[c] - a.color[c]) * k;
  return out;
}

/** Which frame of a flipbook a particle shows, given the strip length. */
export function flipbookFrame(f: Flipbook, age: number, lifetime: number, frames: number, ctx: EvalContext): number {
  if (frames <= 1) return 0;
  let frame: number;
  if (f.stretchToLifetime) frame = lifetime > 0 ? Math.floor((age / lifetime) * frames) : 0;
  else frame = Math.floor(age * ev(f.fps, ctx));
  if (f.loop) return ((frame % frames) + frames) % frames;
  return Math.min(frames - 1, Math.max(0, frame));
}

// ---------------------------------------------------------------------------
// Atlas and pools.
// ---------------------------------------------------------------------------

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every effect's texture packed into one image; built by particle-atlas.ts in a browser, or left empty for tests. */
export interface ParticleAtlas {
  texture: THREE.Texture | null;
  width: number;
  height: number;
  /** Effect id to its texture's pixel rectangle in the atlas. Missing means the whole atlas (a white square when there is none). */
  rects: Map<string, AtlasRect>;
}

export const EMPTY_ATLAS: ParticleAtlas = { texture: null, width: 1, height: 1, rects: new Map() };

const VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute float iRot;
attribute vec4 iUv;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = vec2(mix(iUv.x, iUv.z, uv.x), mix(iUv.y, iUv.w, uv.y));
  vColor = iColor;
  float c = cos(iRot);
  float s = sin(iRot);
  vec2 corner = position.xy * iSize;
  vec2 r = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += r;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 tex = texture2D(map, vUv);
  vec4 col = tex * vColor;
  if (col.a < 0.004) discard;
  gl_FragColor = col;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

let whiteTexture: THREE.DataTexture | null = null;

function white(): THREE.DataTexture {
  if (!whiteTexture) {
    whiteTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteTexture.needsUpdate = true;
  }
  return whiteTexture;
}

/** One blend mode's particles: typed arrays for the simulation, instanced attributes for the draw. */
class Pool {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly material: THREE.ShaderMaterial;
  count = 0;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly rot: Float32Array;
  readonly rotRate: Float32Array;
  readonly rnd: Float32Array;
  readonly owner: Array<Emitter | null>;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aRot: THREE.InstancedBufferAttribute;
  private readonly aUv: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;

  constructor(blend: Blend, texture: THREE.Texture | null, readonly capacity = POOL_CAPACITY) {
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.rotRate = new Float32Array(n);
    this.rnd = new Float32Array(n * 4);
    this.owner = new Array<Emitter | null>(n).fill(null);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const instanced = (size: number) => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    this.aPos = instanced(3);
    this.aSize = instanced(2);
    this.aRot = instanced(1);
    this.aUv = instanced(4);
    this.aColor = instanced(4);
    geometry.setAttribute("iPos", this.aPos);
    geometry.setAttribute("iSize", this.aSize);
    geometry.setAttribute("iRot", this.aRot);
    geometry.setAttribute("iUv", this.aUv);
    geometry.setAttribute("iColor", this.aColor);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture ?? white() } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = `particles:${blend}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Remove particle i by moving the last one into its slot. */
  kill(i: number): void {
    const last = this.count - 1;
    this.owner[i]?.onParticleDied();
    if (i !== last) {
      this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.rnd.copyWithin(i * 4, last * 4, last * 4 + 4);
      this.age[i] = this.age[last];
      this.life[i] = this.life[last];
      this.rot[i] = this.rot[last];
      this.rotRate[i] = this.rotRate[last];
      this.owner[i] = this.owner[last];
    }
    this.owner[last] = null;
    this.count = last;
  }

  write(i: number, x: number, y: number, z: number, w: number, h: number, rot: number, uv: Rgba, color: Rgba): void {
    const p = this.aPos.array as Float32Array;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    const s = this.aSize.array as Float32Array;
    s[i * 2] = w;
    s[i * 2 + 1] = h;
    (this.aRot.array as Float32Array)[i] = rot;
    const u = this.aUv.array as Float32Array;
    u[i * 4] = uv[0];
    u[i * 4 + 1] = uv[1];
    u[i * 4 + 2] = uv[2];
    u[i * 4 + 3] = uv[3];
    const c = this.aColor.array as Float32Array;
    c[i * 4] = color[0];
    c[i * 4 + 1] = color[1];
    c[i * 4 + 2] = color[2];
    c[i * 4 + 3] = color[3];
  }

  flush(): void {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const attr of [this.aPos, this.aSize, this.aRot, this.aUv, this.aColor]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Emitters.
// ---------------------------------------------------------------------------

const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpUv: Rgba = [0, 0, 1, 1];
const tmpColor: Rgba = [1, 1, 1, 1];

function randomUnit(out: THREE.Vector3, random: () => number): THREE.Vector3 {
  const z = random() * 2 - 1;
  const a = random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

export interface EmitterOptions {
  /** Creature scale, applied when the effect declares entity scaling. */
  scale?: number;
  random?: () => number;
}

export class Emitter {
  readonly vars: Record<string, number> = {};
  readonly ctx: EvalContext;
  age = 0;
  /** Particles born here still alive. */
  live = 0;
  /** No more spawns: the clip stopped, or the emitter ran its course. */
  done = false;
  private stopped = false;
  private instantFired = false;
  private cycle = -1;
  private accumulator = 0;
  readonly scale: number;
  readonly random: () => number;
  readonly anchorPos = new THREE.Vector3();
  readonly anchorQuat = new THREE.Quaternion();

  constructor(readonly effect: ParsedEffect, readonly anchor: THREE.Object3D, options: EmitterOptions = {}) {
    this.scale = effect.entityScaling ? (options.scale ?? 1) : 1;
    this.random = options.random ?? Math.random;
    this.ctx = { animTime: 0, lifeTime: 0, vars: this.vars, random: this.random };
    for (let i = 1; i <= 4; i++) this.vars[`emitter_random_${i}`] = this.random();
    this.vars.emitter_age = 0;
    this.vars.emitter_lifetime = 0;
    this.vars.particle_age = 0;
    this.vars.particle_lifetime = 0;
    if (effect.creation) runMolangScript(effect.creation, this.ctx);
    this.readAnchor();
  }

  get id(): string {
    return this.effect.id;
  }

  /** The clip that fired this emitter ended; let what is in the air finish. */
  stop(): void {
    this.stopped = true;
    this.done = true;
  }

  onParticleDied(): void {
    this.live = Math.max(0, this.live - 1);
  }

  readAnchor(): void {
    this.anchor.updateWorldMatrix(true, false);
    this.anchor.matrixWorld.decompose(this.anchorPos, this.anchorQuat, tmpScale);
  }

  /** Advance the emitter; returns how many particles to spawn this frame. */
  step(dt: number): number {
    if (this.done) return 0;
    this.age += dt;
    this.ctx.animTime = this.age;
    this.ctx.lifeTime = this.age;
    this.vars.emitter_age = this.age;
    this.vars.particle_age = 0;
    this.vars.particle_lifetime = 0;
    if (this.effect.perUpdate) runMolangScript(this.effect.perUpdate, this.ctx);

    const life = this.effect.lifetime;
    let active: boolean;
    switch (life.kind) {
      case "once": {
        const activeTime = ev(life.activeTime, this.ctx);
        this.vars.emitter_lifetime = activeTime;
        active = this.age <= activeTime || !this.instantFired;
        if (this.age > activeTime) this.done = true;
        break;
      }
      case "looping": {
        const activeTime = ev(life.activeTime, this.ctx);
        const sleep = ev(life.sleepTime, this.ctx);
        const period = activeTime + sleep;
        this.vars.emitter_lifetime = activeTime;
        const cycle = period > 0 ? Math.floor(this.age / period) : 0;
        if (cycle !== this.cycle) {
          this.cycle = cycle;
          this.instantFired = false;
        }
        active = period > 0 ? this.age - cycle * period <= activeTime : true;
        break;
      }
      case "expression": {
        active = ev(life.activation, this.ctx) !== 0;
        if (ev(life.expiration, this.ctx) !== 0) {
          this.done = true;
          active = false;
        }
        break;
      }
    }
    if (!active) return 0;

    const rate = this.effect.rate;
    if (rate.kind === "instant") {
      if (this.instantFired) return 0;
      this.instantFired = true;
      return Math.max(0, Math.round(ev(rate.count, this.ctx)));
    }
    this.instantFired = true;
    this.accumulator += ev(rate.rate, this.ctx) * dt;
    const max = ev(rate.max, this.ctx);
    let n = 0;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      if (this.live + n < max) n++;
    }
    return n;
  }
}

/** Direction and offset for one new particle, in emitter space before scaling. Exported for the tests. */
export function spawnPoint(shape: EmitterShape, ctx: EvalContext, random: () => number, outOffset: THREE.Vector3, outDir: THREE.Vector3): void {
  outOffset.set(ev(shape.offset[0], ctx), ev(shape.offset[1], ctx), ev(shape.offset[2], ctx));
  tmpA.set(0, 0, 0);
  switch (shape.kind) {
    case "point":
      break;
    case "sphere": {
      const r = ev(shape.radius, ctx);
      randomUnit(tmpA, random).multiplyScalar(shape.surfaceOnly ? r : r * Math.cbrt(random()));
      break;
    }
    case "disc": {
      const r = ev(shape.radius, ctx);
      const d = shape.surfaceOnly ? r : r * Math.sqrt(random());
      const a = random() * Math.PI * 2;
      tmpB.set(ev(shape.normal[0], ctx), ev(shape.normal[1], ctx), ev(shape.normal[2], ctx));
      if (tmpB.lengthSq() < 1e-8) tmpB.set(0, 1, 0);
      tmpB.normalize();
      // Two axes across the plane.
      const u = Math.abs(tmpB.y) < 0.9 ? tmpC.set(0, 1, 0) : tmpC.set(1, 0, 0);
      const ex = u.cross(tmpB).normalize();
      const ey = tmpD.crossVectors(tmpB, ex).normalize();
      tmpA.copy(ex).multiplyScalar(Math.cos(a) * d).addScaledVector(ey, Math.sin(a) * d);
      break;
    }
    case "box": {
      const hx = ev(shape.half[0], ctx);
      const hy = ev(shape.half[1], ctx);
      const hz = ev(shape.half[2], ctx);
      tmpA.set((random() * 2 - 1) * hx, (random() * 2 - 1) * hy, (random() * 2 - 1) * hz);
      if (shape.surfaceOnly) {
        // Pin one non-flat axis to a face.
        const axes = [hx, hy, hz].map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
        if (axes.length > 0) {
          const axis = axes[Math.floor(random() * axes.length)];
          const sign = random() < 0.5 ? -1 : 1;
          tmpA.setComponent(axis, sign * [hx, hy, hz][axis]);
        }
      }
      break;
    }
  }
  const dir = shape.direction;
  if (dir === "inwards" || dir === "outwards" || dir === null) {
    if (tmpA.lengthSq() > 1e-10) outDir.copy(tmpA).normalize();
    else randomUnit(outDir, random);
    if (dir === "inwards") outDir.negate();
  } else {
    outDir.set(ev(dir[0], ctx), ev(dir[1], ctx), ev(dir[2], ctx));
  }
  outOffset.add(tmpA);
}

export class ParticleSystem {
  /** Holds the pool meshes; add it to the scene at the root, with no transform. */
  readonly root = new THREE.Group();
  private readonly pools = new Map<Blend, Pool>();
  private emitters: Emitter[] = [];

  constructor(private readonly atlas: ParticleAtlas = EMPTY_ATLAS, private readonly capacity = POOL_CAPACITY) {
    this.root.name = "particles";
  }

  spawn(effect: ParsedEffect, anchor: THREE.Object3D, options: EmitterOptions = {}): Emitter {
    const emitter = new Emitter(effect, anchor, options);
    this.emitters.push(emitter);
    return emitter;
  }

  get particleCount(): number {
    let n = 0;
    for (const pool of this.pools.values()) n += pool.count;
    return n;
  }

  /** Effect ids of emitters still spawning or still draining. */
  get activeEmitters(): string[] {
    return this.emitters.map((e) => e.id);
  }

  get drawCalls(): number {
    let n = 0;
    for (const pool of this.pools.values()) if (pool.count > 0) n++;
    return n;
  }

  private pool(blend: Blend): Pool {
    let pool = this.pools.get(blend);
    if (!pool) {
      pool = new Pool(blend, this.atlas.texture, this.capacity);
      this.pools.set(blend, pool);
      this.root.add(pool.mesh);
    }
    return pool;
  }

  private spawnOne(emitter: Emitter, pool: Pool): void {
    if (pool.count >= pool.capacity) return;
    const i = pool.count++;
    const e = emitter.effect;
    const ctx = emitter.ctx;
    const vars = emitter.vars;
    for (let k = 0; k < 4; k++) {
      const r = emitter.random();
      pool.rnd[i * 4 + k] = r;
      vars[`particle_random_${k + 1}`] = r;
    }
    vars.particle_age = 0;
    const life = Math.max(0.01, ev(e.maxLifetime, ctx));
    vars.particle_lifetime = life;
    pool.age[i] = 0;
    pool.life[i] = life;
    pool.owner[i] = emitter;
    emitter.live++;

    spawnPoint(e.shape, ctx, emitter.random, tmpPos, tmpDir);
    tmpPos.multiplyScalar(emitter.scale);
    if (Array.isArray(e.initialSpeed)) {
      tmpV.set(ev(e.initialSpeed[0], ctx), ev(e.initialSpeed[1], ctx), ev(e.initialSpeed[2], ctx)).multiplyScalar(emitter.scale);
    } else {
      tmpV.copy(tmpDir).multiplyScalar(ev(e.initialSpeed, ctx) * emitter.scale);
    }
    if (!e.local) {
      tmpPos.applyQuaternion(emitter.anchorQuat).add(emitter.anchorPos);
      tmpV.applyQuaternion(emitter.anchorQuat);
    }
    pool.pos[i * 3] = tmpPos.x;
    pool.pos[i * 3 + 1] = tmpPos.y;
    pool.pos[i * 3 + 2] = tmpPos.z;
    pool.vel[i * 3] = tmpV.x;
    pool.vel[i * 3 + 1] = tmpV.y;
    pool.vel[i * 3 + 2] = tmpV.z;
    pool.rot[i] = THREE.MathUtils.degToRad(ev(e.spin.rotation, ctx));
    pool.rotRate[i] = THREE.MathUtils.degToRad(ev(e.spin.rate, ctx));
  }

  /** UV rectangle for a particle, as (u0, vBottom, u1, vTop) in atlas space, GL orientation. */
  private uvRect(e: ParsedEffect, age: number, life: number, ctx: EvalContext, out: Rgba): void {
    const b = e.billboard;
    let px: number;
    let py: number;
    let pw: number;
    let ph: number;
    if (b.uv.kind === "flipbook") {
      const f = b.uv;
      const sx = ev(f.step[0], ctx);
      const sy = ev(f.step[1], ctx);
      pw = ev(f.size[0], ctx);
      ph = ev(f.size[1], ctx);
      let frames: number;
      if (f.maxFrame !== null) frames = Math.max(1, Math.round(ev(f.maxFrame, ctx)));
      else {
        const alongX = sx !== 0 ? Math.floor((b.textureWidth - ev(f.base[0], ctx)) / Math.abs(sx)) : Infinity;
        const alongY = sy !== 0 ? Math.floor((b.textureHeight - ev(f.base[1], ctx)) / Math.abs(sy)) : Infinity;
        frames = Math.max(1, Math.min(alongX, alongY) === Infinity ? 1 : Math.min(alongX, alongY));
      }
      const frame = flipbookFrame(f, age, life, frames, ctx);
      px = ev(f.base[0], ctx) + sx * frame;
      py = ev(f.base[1], ctx) + sy * frame;
    } else {
      px = ev(b.uv.uv[0], ctx);
      py = ev(b.uv.uv[1], ctx);
      pw = ev(b.uv.uvSize[0], ctx);
      ph = ev(b.uv.uvSize[1], ctx);
    }
    const rect = this.atlas.rects.get(e.id) ?? { x: 0, y: 0, w: this.atlas.width, h: this.atlas.height };
    const kx = rect.w / b.textureWidth;
    const ky = rect.h / b.textureHeight;
    const ax = rect.x + px * kx;
    const ay = rect.y + py * ky;
    const aw = pw * kx;
    const ah = ph * ky;
    const W = this.atlas.width;
    const H = this.atlas.height;
    // A hair inside the rectangle, so nearest sampling never reads the neighbour.
    const inset = 0.02;
    out[0] = (ax + inset) / W;
    out[2] = (ax + aw - inset) / W;
    out[3] = 1 - (ay + inset) / H;
    out[1] = 1 - (ay + ah - inset) / H;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const emitter of this.emitters) {
      emitter.readAnchor();
      const n = emitter.step(dt);
      if (n > 0) {
        const pool = this.pool(emitter.effect.blend);
        for (let k = 0; k < n; k++) this.spawnOne(emitter, pool);
      }
    }

    for (const pool of this.pools.values()) {
      let i = 0;
      while (i < pool.count) {
        pool.age[i] += dt;
        if (pool.age[i] >= pool.life[i]) {
          pool.kill(i);
          continue;
        }
        const emitter = pool.owner[i]!;
        const e = emitter.effect;
        const ctx = emitter.ctx;
        const vars = emitter.vars;
        const age = pool.age[i];
        const life = pool.life[i];
        vars.particle_age = age;
        vars.particle_lifetime = life;
        for (let k = 0; k < 4; k++) vars[`particle_random_${k + 1}`] = pool.rnd[i * 4 + k];
        for (const curve of e.curves) vars[curve.name] = evalCurve(curve, ctx);

        // Motion.
        const s = emitter.scale;
        const ax = ev(e.dynamic.acceleration[0], ctx) * s;
        const ay = ev(e.dynamic.acceleration[1], ctx) * s;
        const az = ev(e.dynamic.acceleration[2], ctx) * s;
        const drag = Math.min(1 / dt, Math.max(0, ev(e.dynamic.drag, ctx)));
        let vx = pool.vel[i * 3] + ax * dt;
        let vy = pool.vel[i * 3 + 1] + ay * dt;
        let vz = pool.vel[i * 3 + 2] + az * dt;
        const keep = 1 - drag * dt;
        vx *= keep;
        vy *= keep;
        vz *= keep;
        pool.vel[i * 3] = vx;
        pool.vel[i * 3 + 1] = vy;
        pool.vel[i * 3 + 2] = vz;
        pool.pos[i * 3] += vx * dt;
        pool.pos[i * 3 + 1] += vy * dt;
        pool.pos[i * 3 + 2] += vz * dt;
        const rotDrag = Math.min(1 / dt, Math.max(0, ev(e.dynamic.rotationDrag, ctx)));
        pool.rotRate[i] = (pool.rotRate[i] + THREE.MathUtils.degToRad(ev(e.dynamic.rotationAcceleration, ctx)) * dt) * (1 - rotDrag * dt);
        pool.rot[i] += pool.rotRate[i] * dt;

        // Appearance.
        const w = ev(e.billboard.size[0], ctx) * s * SIZE_TO_WIDTH;
        const h = ev(e.billboard.size[1], ctx) * s * SIZE_TO_WIDTH;
        this.uvRect(e, age, life, ctx, tmpUv);
        if (e.tint.kind === "gradient") sampleGradient(e.tint.stops, ev(e.tint.interpolant, ctx), tmpColor);
        else {
          tmpColor[0] = ev(e.tint.color[0], ctx);
          tmpColor[1] = ev(e.tint.color[1], ctx);
          tmpColor[2] = ev(e.tint.color[2], ctx);
          tmpColor[3] = ev(e.tint.color[3], ctx);
        }

        // Placement: local particles ride the locator.
        tmpPos.set(pool.pos[i * 3], pool.pos[i * 3 + 1], pool.pos[i * 3 + 2]);
        if (e.local) tmpPos.applyQuaternion(emitter.anchorQuat).add(emitter.anchorPos);
        pool.write(i, tmpPos.x, tmpPos.y, tmpPos.z, w, h, pool.rot[i], tmpUv, tmpColor);
        i++;
      }
      pool.flush();
    }

    this.emitters = this.emitters.filter((e) => !(e.done && e.live === 0));
  }

  /** Stop every emitter; particles in the air finish on their own. */
  stopAll(): void {
    for (const e of this.emitters) e.stop();
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      this.root.remove(pool.mesh);
      pool.dispose();
    }
    this.pools.clear();
    this.emitters = [];
  }
}
