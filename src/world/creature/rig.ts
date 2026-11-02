/**
 * A loaded creature in the scene: model, mixer, layer stack, movement over
 * ground, water and air, emote bubble, cry. The React component owns one of
 * these and calls `update` every frame. It also serves as the store's
 * CreatureController.
 *
 * A pose is a stack: the poser's keyframe clips play together through the
 * mixer (additively, on the rest pose), the procedural layers (walk swing,
 * head look, wing flap) are added each frame on top, and quirks (blink)
 * fire as one-shot clips over everything.
 *
 * Sleep without a sleep clip (Eevee and many others) is procedural: the
 * whole model eases onto its side over a second, the idle clip slows to a
 * breath, and the blink quirk stays off until the creature gets up.
 *
 * Movement follows the species behaviour. A walker paths over the land
 * grid; a swimmer adds the water grid and sinks to a float height inside a
 * water volume; a water-only species is redirected to water spots; a flier
 * travels in a straight line at hover height and lands only on sleep spots.
 *
 * Particle effects ride the clips. Each clip's `particle_effects` block is
 * read once into keyframes; every frame the rig compares an action's time
 * with where it was last frame and fires whatever it crossed, so a looping
 * clip refires each loop and a one-shot fires on its way through. A
 * steady emitter at 0.0 of a looping idle (Gastly's smoke) lives while the
 * clip plays and is told to stop when the clip fades out or stops. The
 * particles draw from `effects`, a sibling of `group` at the scene root,
 * because their positions are world positions.
 */

import * as THREE from "three";
import type { Activity, EmoteKind, PokemonBundle } from "../api";
import { applyLoop, type ClipLibrary, createClipLibrary } from "../bedrock/animation";
import { buildModel, type LoadedModel } from "../bedrock/geometry";
import { mergeBoneCubes } from "../bedrock/merge";
import { warnOnce } from "../bedrock/molang";
import { buildParticleAtlas } from "../bedrock/particle-atlas";
import {
  clipParticleKeyframes,
  EMPTY_ATLAS,
  type Emitter,
  isHandlerEffect,
  type ParsedEffect,
  type ParticleAtlas,
  type ParticleKeyframe,
  parseParticleDefinition,
  ParticleSystem,
} from "../bedrock/particles";
import { type PoserMap, type PoseStack, readPoser, resolveActivity } from "../bedrock/poser";
import { createBedrockMaterial, loadBedrockTexture, loadEmissiveTexture } from "../bedrock/texture";
import type { DioramaDef, Medium, Spot, WaterVolume } from "../dioramas/types";
import { cellToWorld, createNavGrid, findPath, type NavGrid, nearestWalkable, simplifyPath, worldToCell } from "../nav/grid";
import type { CreatureController } from "../store";
import { emoteTexture } from "./emotes";
import { ProceduralStack } from "./layers";
import { type Locomotion, readLocomotion, resolveSpot, spotMedium } from "./locomotion";
import { measure, now, timed, timedSync } from "../perf";

const WALK_SPEED = 1.7; // blocks per second at baseScale 1
const SWIM_FACTOR = 0.8;
const FLY_FACTOR = 1.3;
const CLIMB_SPEED = 1.6; // blocks per second up or down
const TURN_SPEED = 9; // radians per second
const FADE = 0.25;
/** Seconds the procedural sleep takes to lie down, and to get up again. */
const SLEEP_EASE = 1.0;
/** How far a sleeper without a sleep clip rolls onto its side. */
const SLEEP_ROLL = THREE.MathUtils.degToRad(82);
/** Idle plays this slow while lying down, so the breathing reads as sleep. */
const SLEEP_TIME_SCALE = 0.3;
/** Clips the poser plays at load; the rest are sampled on first use. */
const PREBUILT_ACTIVITIES: Activity[] = ["idle", "walk", "sleep"];

/**
 * Starts (or re-fades) a base pose clip at full weight.
 *
 * The base weight must be 1: three.js multiplies the fade curve by it, so
 * `setEffectiveWeight(0).fadeIn()` ramps from 0 to 0 and the clip never
 * shows. That bug left every walker in its rest pose mid-stride and, after
 * the first walk, in its rest pose while idle too (Bayleef's head leaf
 * jutting straight out was the first visible symptom).
 */
export function startBaseAction(action: THREE.AnimationAction, immediate: boolean, fade = FADE): void {
  if (!action.isRunning()) action.reset();
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.stopFading();
  action.setEffectiveWeight(1);
  if (!immediate) action.fadeIn(fade);
  action.play();
}
const EMOTE_SECONDS = 1.8;
const ARRIVE_EPSILON = 0.05;

/** The particle effects a creature's clips fire, parsed, with their sprite sheets packed. */
export interface ParticleAssets {
  effects: Map<string, ParsedEffect>;
  atlas: ParticleAtlas;
}

export interface LoadedCreature {
  model: LoadedModel;
  clips: ClipLibrary;
  poser: PoserMap;
  texture: THREE.Texture | null;
  emissive: THREE.Texture | null;
  /** The frames of an animated glow layer, `emissive` first, and how fast to flip them. */
  emissiveFrames?: { textures: THREE.Texture[]; fps: number };
  material: THREE.Material;
  bundle: PokemonBundle;
  /** Draw calls the model costs: one per bone with cubes. */
  meshes: number;
  /** Absent for a species whose clips fire nothing. */
  particles?: ParticleAssets;
  dispose(): void;
}

/** Parse the bundle's effect definitions and pack their textures; undefined when there are none. */
async function loadParticleAssets(bundle: PokemonBundle, label: string): Promise<ParticleAssets | undefined> {
  const assets = bundle.particles;
  if (!assets || Object.keys(assets).length === 0) return undefined;
  const effects = new Map<string, ParsedEffect>();
  for (const [id, asset] of Object.entries(assets)) effects.set(id, parseParticleDefinition(asset.definition));
  let atlas: ParticleAtlas = EMPTY_ATLAS;
  if (typeof document !== "undefined") {
    try {
      atlas = await timed(`${label}:particles`, () => buildParticleAtlas(assets));
    } catch (err) {
      console.warn(`[world] particle textures failed for ${bundle.species}, drawing them white`, err);
    }
  }
  return { effects, atlas };
}

/**
 * Build a creature from its bundle. `label` prefixes the performance
 * measures (`creature` for the active pokemon, `ambient` for the dressing).
 */
export async function loadCreature(bundle: PokemonBundle, aspects: string[], label = "creature"): Promise<LoadedCreature> {
  const shiny = aspects.includes("shiny") && bundle.textures.shiny;
  const url = shiny ? bundle.textures.shiny! : bundle.textures.base;
  let texture: THREE.Texture | null = null;
  let emissive: THREE.Texture | null = null;
  const t0 = now();
  try {
    texture = await timed(`${label}:texture`, () => loadBedrockTexture(url));
  } catch (err) {
    console.warn(`[world] texture failed for ${bundle.species}, drawing untextured`, err);
  }
  let emissiveFrames: LoadedCreature["emissiveFrames"];
  if (bundle.textures.emissive) {
    try {
      const frames = bundle.textures.emissiveFrames;
      if (frames && frames.urls.length > 1) {
        const textures = await timed(`${label}:emissive`, () => Promise.all(frames.urls.map((u) => loadEmissiveTexture(u))));
        emissive = textures[0];
        emissiveFrames = { textures, fps: frames.fps > 0 ? frames.fps : 10 };
      } else {
        emissive = await timed(`${label}:emissive`, () => loadEmissiveTexture(bundle.textures.emissive!));
      }
    } catch (err) {
      console.warn(`[world] emissive texture failed for ${bundle.species}, drawing without glow`, err);
    }
  }
  const material = createBedrockMaterial(texture, emissive);
  const model = timedSync(`${label}:geometry`, () => buildModel(bundle.geometry, material));
  const meshes = timedSync(`${label}:merge`, () => mergeBoneCubes(model));
  // Riding clips animate seat locators the geometry does not carry; the
  // mixer would warn on every such track, so drop them as each clip is built.
  const clips = createClipLibrary(bundle.animations, (clip) => {
    clip.clip.tracks = clip.clip.tracks.filter((t) => model.bones.has(t.name.slice(0, t.name.indexOf("."))));
  });
  const poser = timedSync(`${label}:poser`, () => readPoser(bundle.poser, clips.names()));
  // Sample only what plays at load: the resting, walking and sleeping
  // stacks and the quirks. Cries, faints and the swim or fly stacks of a
  // species that starts on land wait for their first use.
  timedSync(`${label}:clips`, () => {
    for (const activity of PREBUILT_ACTIVITIES) clips.prebuild(resolveActivity(poser, activity)?.clips ?? []);
    clips.prebuild(poser.quirks);
  });
  const particles = await loadParticleAssets(bundle, label);
  measure(`${label}:load`, t0);
  return {
    model,
    clips,
    poser,
    texture,
    emissive,
    emissiveFrames,
    material,
    bundle,
    meshes,
    particles,
    dispose() {
      model.dispose();
      material.dispose();
      texture?.dispose();
      if (emissiveFrames) for (const t of emissiveFrames.textures) t.dispose();
      else emissive?.dispose();
      particles?.atlas.texture?.dispose();
    },
  };
}

/** Yaw that points the model's front (-Z) along a direction. */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The grid a creature may travel: land, water, or both. */
export function travelGrid(diorama: DioramaDef, loco: Locomotion): NavGrid {
  if (loco.walks && !loco.swims) return diorama.nav;
  if (!loco.walks && loco.swims) return diorama.swimNav;
  const grid = createNavGrid(diorama.nav.originX, diorama.nav.originZ, diorama.nav.width, diorama.nav.depth);
  for (let i = 0; i < grid.walkable.length; i++) grid.walkable[i] = diorama.nav.walkable[i] | diorama.swimNav.walkable[i];
  return grid;
}

export interface Orbit {
  x: number;
  z: number;
  y: number;
  radius: number;
  /** Radians per second; negative for clockwise. */
  speed: number;
}

/** An action whose clip fires particles, and where its time was last frame. */
interface TrackedClip {
  action: THREE.AnimationAction;
  keyframes: ParticleKeyframe[];
  lastTime: number;
  playing: boolean;
  /** Emitters that live as long as the clip plays, by keyframe index. */
  continuous: Map<number, Emitter>;
}

/** An action counts as playing once it carries at least this much weight, so a fade-in starts its effects and a fade-out ends them. */
const PARTICLE_WEIGHT = 0.5;

export class CreatureRig implements CreatureController {
  readonly group = new THREE.Group();
  /** The particle meshes; mount it beside `group` at the scene root, untransformed. */
  readonly effects: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  /** Height of the model in blocks after baseScale, for framing. */
  readonly height: number;
  readonly locomotion: Locomotion;

  /**
   * Sits between the group and the model root, at the body's centre, so
   * the procedural sleep can roll the whole model onto its side.
   */
  private readonly body = new THREE.Group();
  /** Width of the model in blocks after baseScale; a sleeper rests on half of it. */
  private readonly width: number;
  /** 0 standing, 1 lying on its side; eased toward `sleepTarget` every frame. */
  private sleepT = 0;
  private sleepTarget = 0;
  /** Speed of the base clips: 1, or slower while lying down. */
  private baseTimeScale = 1;

  private readonly actions = new Map<string, THREE.AnimationAction>();
  private baseClips: string[] = [];
  private procedural: ProceduralStack;
  private activity: Activity = "idle";
  private diorama: DioramaDef;
  /** The cells this creature may travel: land, water or both. Read by the ambient wander planner. */
  grid: NavGrid;
  private path: Array<{ x: number; z: number }> = [];
  private moveResolve: ((ok: boolean) => void) | null = null;
  private arriveFacing: number | undefined;
  private yaw = Math.PI;
  private targetYaw = Math.PI;
  private readonly scale: number;
  private currentSpeed = 0;
  private blinkIn = 2 + Math.random() * 4;
  private readonly sprite: THREE.Sprite;
  private emoteLeft = 0;
  private emoteAnchorY: number;
  private readonly emoteSize: number;
  private audio: HTMLAudioElement | null = null;
  private readonly bones: Map<string, THREE.Object3D>;
  /** What the creature is in right now. */
  private medium: Medium = "land";
  /** A flier on the ground (sleeping, or on a sleep spot). */
  private landed = false;
  private hoverY = 3;
  private orbit: Orbit | null = null;
  private orbitAngle = 0;
  private elapsed = 0;
  private readonly particles: ParticleSystem | null;
  /** `locator:<name>` groups from the geometry, by name; the first of a repeated name wins. */
  private readonly locators = new Map<string, THREE.Object3D>();
  private readonly tracked = new Map<string, TrackedClip>();

  constructor(readonly loaded: LoadedCreature, diorama: DioramaDef) {
    this.diorama = diorama;
    this.locomotion = readLocomotion(loaded.bundle.behaviour);
    this.grid = travelGrid(diorama, this.locomotion);
    const scale = loaded.bundle.baseScale ?? 1;
    this.scale = scale;
    loaded.model.root.scale.multiplyScalar(scale);
    this.height = Math.max(0.3, loaded.model.bounds.max.y * scale);
    this.width = Math.max(0.2, (loaded.model.bounds.max.x - loaded.model.bounds.min.x) * scale);
    // The root hangs under the pivot by half the height, and the pivot sits
    // that high, so nothing moves until the sleep roll lowers the pivot.
    loaded.model.root.position.y = -this.height / 2;
    this.body.position.y = this.height / 2;
    this.body.add(loaded.model.root);
    this.group.add(this.body);
    this.mixer = new THREE.AnimationMixer(loaded.model.root);
    this.bones = new Map(loaded.model.bones);
    this.procedural = new ProceduralStack(this.bones, loaded.model.root, []);
    this.particles = loaded.particles ? new ParticleSystem(loaded.particles.atlas) : null;
    this.effects = this.particles?.root ?? new THREE.Group();
    loaded.model.root.traverse((obj) => {
      if (obj.name.startsWith("locator:") && !this.locators.has(obj.name.slice(8))) this.locators.set(obj.name.slice(8), obj);
    });

    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: true, toneMapped: false, fog: false }),
    );
    this.emoteSize = 0.2 + 0.3 * this.height;
    this.sprite.scale.setScalar(this.emoteSize);
    this.sprite.visible = false;
    this.emoteAnchorY = this.height + 0.6 * this.emoteSize;
    this.sprite.position.set(0, this.emoteAnchorY, 0);
    this.group.add(this.sprite);

    this.teleport(this.spawnSpot(diorama));
    this.setActivity(this.restingActivity(), true);
  }

  /** Ground position in world units. */
  get position(): { x: number; z: number } {
    return { x: this.group.position.x, z: this.group.position.z };
  }

  /** Where it stands when the trainer is here. */
  get homeSpot(): Spot {
    return this.spawnSpot(this.diorama);
  }

  /** Where the camera should look: the spot this creature rests at after loading, and how high it sits there. */
  get restSpot(): { x: number; y: number; z: number } {
    const s = this.spawnSpot(this.diorama);
    const medium = this.locomotion.flies ? "air" : this.waterAt(s.x, s.z) ? "water" : "land";
    let y = 0;
    if (medium === "air") y = spotMedium(s) === "air" && s.y !== undefined ? s.y : this.defaultHoverY();
    if (medium === "water") {
      const w = this.waterAt(s.x, s.z)!;
      y = w.y - this.sinkDepth(w);
    }
    return { x: s.x, y, z: s.z };
  }

  /** How far below the surface a floating body sits: a third of its height, never through the floor. */
  private sinkDepth(w: WaterVolume): number {
    return Math.min(this.height * 0.3, w.depth - 0.05);
  }

  /** Where this creature first appears: the spawn, or the nearest water spot for a water-only species. */
  private spawnSpot(diorama: DioramaDef): Spot {
    const name = resolveSpot(diorama.spots, "play_1", this.locomotion) ?? "play_1";
    return diorama.spots[name] ?? diorama.spawn;
  }

  setDiorama(diorama: DioramaDef): void {
    this.cancelMove();
    this.wake();
    this.diorama = diorama;
    this.grid = travelGrid(diorama, this.locomotion);
    this.teleport(this.spawnSpot(diorama));
    this.setActivity(this.restingActivity());
  }

  teleport(spot: Spot): void {
    this.group.position.set(spot.x, 0, spot.z);
    if (spot.facing !== undefined) {
      this.yaw = spot.facing;
      this.targetYaw = spot.facing;
      this.group.rotation.y = this.yaw;
    }
    this.landed = false;
    if (spotMedium(spot) === "air" && spot.y !== undefined) this.hoverY = spot.y;
    else this.hoverY = this.defaultHoverY();
    this.medium = this.mediumAt(spot.x, spot.z);
    this.group.position.y = this.targetY();
  }

  /** Just above the air volume's floor: the portrait camera cannot see much higher at the subject. */
  private defaultHoverY(): number {
    const air = this.diorama.air[0];
    if (!air) return 1;
    return air.yMin + 0.1;
  }

  private waterAt(x: number, z: number): WaterVolume | undefined {
    return this.diorama.water.find((w) => x >= w.x && x < w.x + w.w && z >= w.z && z < w.z + w.d);
  }

  /** The medium a point puts this creature in. */
  private mediumAt(x: number, z: number): Medium {
    if (this.locomotion.flies && !this.landed) return "air";
    return this.waterAt(x, z) ? "water" : "land";
  }

  /** Where the body should sit vertically for the current medium. */
  private targetY(): number {
    if (this.medium === "air") return this.hoverY + Math.sin(this.elapsed * 1.7) * 0.06;
    if (this.medium === "water") {
      const w = this.waterAt(this.group.position.x, this.group.position.z);
      if (!w) return 0;
      return w.y - this.sinkDepth(w) + Math.sin(this.elapsed * 1.3) * 0.02;
    }
    return 0;
  }

  /** The pose for standing still in the current medium. */
  private restingActivity(): Activity {
    if (this.medium === "air") return "hover";
    if (this.medium === "water") return "float";
    if (this.locomotion.waterOnly) return "float";
    return "idle";
  }

  /** The pose for moving through the current medium. */
  private movingActivity(): Activity {
    if (this.medium === "air") return "fly";
    if (this.medium === "water") return "swim";
    if (this.locomotion.waterOnly) return "swim";
    return "walk";
  }

  private action(name: string): THREE.AnimationAction | null {
    const existing = this.actions.get(name);
    if (existing) return existing;
    const clip = this.loaded.clips.get(name);
    if (!clip) return null;
    const action = this.mixer.clipAction(clip.clip);
    applyLoop(action, clip.loop);
    this.actions.set(name, action);
    if (this.particles) {
      const keyframes = clipParticleKeyframes(this.loaded.bundle.animations.animations?.[name]);
      if (keyframes.length > 0) this.tracked.set(name, { action, keyframes, lastTime: 0, playing: false, continuous: new Map() });
    }
    return action;
  }

  /** Live particles this creature is drawing. */
  get particleCount(): number {
    return this.particles?.particleCount ?? 0;
  }

  /** Effect ids of emitters still spawning or draining. */
  get activeEmitters(): string[] {
    return this.particles?.activeEmitters ?? [];
  }

  /** Draw calls the particles cost right now: one per blend mode with anything in it, so at most two. */
  get particleDrawCalls(): number {
    return this.particles?.drawCalls ?? 0;
  }

  /** Play a quirk clip now (the first one, or the one whose name contains `name`); false when there is none. */
  playQuirk(name?: string): boolean {
    const quirks = this.loaded.poser.quirks;
    const pick = name ? quirks.find((q) => q.includes(name)) : quirks[0];
    return this.playOnce(pick);
  }

  /** Fire the keyframes an action crossed since last frame, then step the particles. */
  private updateParticles(dt: number): void {
    if (!this.particles) return;
    for (const t of this.tracked.values()) {
      const action = t.action;
      const playing = action.isRunning() && action.getEffectiveWeight() >= PARTICLE_WEIGHT;
      if (playing) {
        const time = action.time;
        if (!t.playing) this.fireRange(t, -1, time);
        else if (time < t.lastTime) {
          // Looped: the tail of the last pass, then the head of this one.
          this.fireRange(t, t.lastTime, Infinity);
          this.fireRange(t, -1, time);
        } else this.fireRange(t, t.lastTime, time);
        t.lastTime = time;
        t.playing = true;
      } else if (t.playing) {
        t.playing = false;
        for (const emitter of t.continuous.values()) emitter.stop();
        t.continuous.clear();
      }
    }
    this.particles.update(dt);
  }

  /** Fire keyframes with `from < time <= to`. */
  private fireRange(t: TrackedClip, from: number, to: number): void {
    for (let i = 0; i < t.keyframes.length; i++) {
      const k = t.keyframes[i];
      if (k.time > from && k.time <= to) this.fireKeyframe(t, i, k);
    }
  }

  private fireKeyframe(t: TrackedClip, index: number, k: ParticleKeyframe): void {
    const species = this.loaded.bundle.species;
    if (isHandlerEffect(k.effect)) {
      warnOnce(`particle-handler:${k.effect}`, `${species} fires ${k.effect}, which is code in the mod; skipped`);
      return;
    }
    const effect = this.loaded.particles?.effects.get(k.effect);
    if (!effect) {
      warnOnce(`particle-missing:${k.effect}`, `${species} fires ${k.effect}, which the cache has no definition for; skipped`);
      return;
    }
    // Steady, looping and expression emitters run with the clip; a `once`
    // emitter runs its course and may fire again on the next pass.
    const continuous = effect.lifetime.kind !== "once";
    if (continuous) {
      const alive = t.continuous.get(index);
      if (alive && !alive.done) return;
    }
    let anchor: THREE.Object3D = this.loaded.model.root;
    if (k.locator) {
      const found = this.locators.get(k.locator);
      if (found) anchor = found;
      else warnOnce(`particle-locator:${species}:${k.locator}`, `${species} has no locator ${k.locator} for ${k.effect}; emitting from the root`);
    }
    const emitter = this.particles!.spawn(effect, anchor, { scale: this.scale });
    if (continuous) t.continuous.set(index, emitter);
  }

  private applyStack(stack: PoseStack, immediate: boolean): void {
    const next = stack.clips;
    for (const name of this.baseClips) {
      if (next.includes(name)) continue;
      const action = this.actions.get(name);
      if (!action) continue;
      if (immediate) action.stop();
      else action.fadeOut(FADE);
    }
    for (const name of next) {
      const action = this.action(name);
      if (!action) continue;
      // Already playing at full weight: leave it alone so a repeated
      // setActivity (shoreline changes, idle after idle) does not restart it.
      // A clip mid fade-out has dropped below full weight and is restarted.
      if (this.baseClips.includes(name) && action.isRunning() && action.getEffectiveWeight() >= 0.999) continue;
      startBaseAction(action, immediate);
    }
    for (const name of next) this.actions.get(name)?.setEffectiveTimeScale(this.baseTimeScale);
    this.baseClips = [...next];
    this.procedural.restore();
    this.procedural = new ProceduralStack(this.bones, this.loaded.model.root, stack.procedural);
  }

  private setActivity(activity: Activity, immediate = false): void {
    this.activity = activity;
    const stack = resolveActivity(this.loaded.poser, activity);
    if (!stack) return;
    this.applyStack(stack, immediate);
  }

  private playOnce(name: string | undefined, hold = false): boolean {
    if (!name) return false;
    const action = this.action(name);
    if (!action) return false;
    action.reset();
    action.clampWhenFinished = hold;
    action.setEffectiveWeight(1);
    action.play();
    return true;
  }

  play(activity: Activity): void {
    this.cancelMove();
    this.orbit = null;
    if (activity === "cry") {
      this.cry();
      return;
    }
    if (activity === "faint") {
      this.activity = "faint";
      this.landed = this.locomotion.flies;
      this.medium = this.mediumAt(this.group.position.x, this.group.position.z);
      // Fall from whatever pose we were in; the faint clip holds its last frame.
      if (!this.playOnce(this.loaded.poser.faint, true)) this.setActivity("faint");
      return;
    }
    if (activity === "sleep") {
      // A flier comes down to sleep; it takes off again on the next idle.
      this.landed = this.locomotion.flies;
      this.medium = this.mediumAt(this.group.position.x, this.group.position.z);
      this.setActivity("sleep");
      // No sleep clip: the pose above is the idle, so lie the whole model
      // down instead and slow the idle to a breath.
      if (!this.loaded.poser.poses.sleep) this.lieDown();
      return;
    }
    this.wake();
    if (activity === "idle") {
      this.landed = false;
      this.medium = this.mediumAt(this.group.position.x, this.group.position.z);
      this.setActivity(this.restingActivity());
      return;
    }
    this.setActivity(activity);
  }

  /** True while the procedural sleep (no sleep clip) is lying the model down or holding it there. */
  get lyingDown(): boolean {
    return this.sleepTarget === 1;
  }

  /** How far into the procedural sleep roll the model is, 0 standing to 1 on its side. */
  get sleepProgress(): number {
    return this.sleepT;
  }

  private lieDown(): void {
    this.sleepTarget = 1;
    this.setBaseTimeScale(SLEEP_TIME_SCALE);
  }

  /** Undo the procedural sleep; a no-op when the model is standing. */
  private wake(): void {
    if (this.sleepTarget === 0 && this.baseTimeScale === 1) return;
    this.sleepTarget = 0;
    this.setBaseTimeScale(1);
  }

  private setBaseTimeScale(scale: number): void {
    this.baseTimeScale = scale;
    for (const name of this.baseClips) this.actions.get(name)?.setEffectiveTimeScale(scale);
  }

  /** Roll the body by `sleepT`: around its forward axis, dropping so it rests on its side. */
  private applySleepPose(): void {
    const t = THREE.MathUtils.smoothstep(this.sleepT, 0, 1);
    const half = this.height / 2;
    const rest = Math.min(this.width / 2, half);
    this.body.rotation.z = SLEEP_ROLL * t;
    this.body.position.y = THREE.MathUtils.lerp(half, rest, t);
  }

  cry(): void {
    this.playOnce(this.loaded.poser.cry);
    const url = this.loaded.bundle.sounds?.cry;
    if (url) {
      if (!this.audio) this.audio = new Audio(url);
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {
        // Autoplay can be blocked before the first tap; the clip still plays.
      });
    }
  }

  emote(kind: EmoteKind): void {
    const material = this.sprite.material as THREE.SpriteMaterial;
    material.map = emoteTexture(kind);
    material.needsUpdate = true;
    this.sprite.visible = true;
    this.emoteLeft = EMOTE_SECONDS;
  }

  /**
   * Travel to a named spot, or to any point given as a Spot. A name goes
   * through `resolveSpot` (water-only species to water, and so on); a point
   * is taken as given, which is how the ambient visitors enter from and
   * leave by the edge of the scene. A flier lands only on a named sleep spot.
   */
  moveTo(spot: string | Spot): Promise<boolean> {
    let target: Spot;
    let land = false;
    if (typeof spot === "string") {
      const name = resolveSpot(this.diorama.spots, spot, this.locomotion);
      if (!name) {
        console.warn(`[world] no spot named ${spot} in ${this.diorama.id}`);
        return Promise.resolve(false);
      }
      target = this.diorama.spots[name];
      land = name.startsWith("sleep");
    } else {
      target = spot;
    }
    this.cancelMove();
    this.wake();
    this.orbit = null;
    this.arriveFacing = target.facing;

    if (this.locomotion.flies) {
      // Take off, fly straight there, and land only on a sleep spot.
      this.landed = false;
      this.medium = "air";
      this.hoverY = spotMedium(target) === "air" && target.y !== undefined ? target.y : this.defaultHoverY();
      this.path = [{ x: target.x, z: target.z }];
      this.landOnArrival = land;
    } else {
      const grid = this.grid;
      const from = nearestWalkable(grid, worldToCell(grid, this.group.position.x, this.group.position.z));
      const to = nearestWalkable(grid, worldToCell(grid, target.x, target.z));
      if (!from || !to) return Promise.resolve(false);
      const cells = findPath(grid, from, to);
      if (!cells) return Promise.resolve(false);
      const points = simplifyPath(cells).map((c) => cellToWorld(grid, c));
      // Finish exactly on the spot rather than the cell centre.
      points.push({ x: target.x, z: target.z });
      this.path = points.slice(1);
      this.landOnArrival = false;
    }
    if (this.path.length === 0) {
      this.finishMove(true);
      return Promise.resolve(true);
    }
    this.setActivity(this.movingActivity());
    return new Promise((resolve) => {
      this.moveResolve = resolve;
    });
  }

  private landOnArrival = false;

  /** Scripted circling for ambient fliers; cleared by any move or play. */
  setOrbit(orbit: Orbit | null): void {
    this.cancelMove();
    this.wake();
    this.orbit = orbit;
    if (orbit) {
      this.landed = false;
      this.medium = "air";
      this.hoverY = orbit.y;
      this.orbitAngle = Math.atan2(this.group.position.z - orbit.z, this.group.position.x - orbit.x);
      this.setActivity("fly");
    }
  }

  /**
   * Fade the whole creature. Ambient visitors arrive and leave through this;
   * at 1 the material goes back to opaque so it sorts with the scene again.
   */
  setOpacity(opacity: number): void {
    const material = this.loaded.material;
    const o = Math.max(0, Math.min(1, opacity));
    material.opacity = o;
    material.transparent = o < 1;
    this.group.visible = o > 0;
  }

  cancelMove(): void {
    if (this.moveResolve) {
      const resolve = this.moveResolve;
      this.moveResolve = null;
      this.path = [];
      resolve(false);
    }
  }

  get isMoving(): boolean {
    return this.path.length > 0 || this.orbit !== null;
  }

  get currentActivity(): Activity {
    return this.activity;
  }

  get currentMedium(): Medium {
    return this.medium;
  }

  private finishMove(ok: boolean): void {
    const resolve = this.moveResolve;
    this.moveResolve = null;
    this.path = [];
    if (this.arriveFacing !== undefined) this.targetYaw = this.arriveFacing;
    if (this.landOnArrival) {
      this.landed = true;
      this.landOnArrival = false;
    }
    this.medium = this.mediumAt(this.group.position.x, this.group.position.z);
    this.setActivity(this.restingActivity());
    resolve?.(ok);
  }

  private travelSpeed(): number {
    const base = WALK_SPEED * Math.max(0.5, this.scale);
    if (this.medium === "air") return base * FLY_FACTOR;
    if (this.medium === "water") return base * SWIM_FACTOR;
    return base;
  }

  /** Advance one frame. `lookTarget` is the world point the look layer aims at while idle. */
  /** Flip an animated glow layer to the frame for this moment. */
  private flipEmissive(): void {
    const frames = this.loaded.emissiveFrames;
    if (!frames) return;
    const material = this.loaded.material as THREE.MeshLambertMaterial;
    const next = frames.textures[Math.floor(this.elapsed * frames.fps) % frames.textures.length];
    if (material.emissiveMap !== next) {
      material.emissiveMap = next;
      material.needsUpdate = false;
    }
  }

  update(dt: number, lookTarget: THREE.Vector3 | null = null): void {
    this.elapsed += dt;
    this.flipEmissive();
    let moved = 0;
    if (this.orbit) {
      const o = this.orbit;
      this.orbitAngle += o.speed * dt;
      const nx = o.x + Math.cos(this.orbitAngle) * o.radius;
      const nz = o.z + Math.sin(this.orbitAngle) * o.radius;
      const dx = nx - this.group.position.x;
      const dz = nz - this.group.position.z;
      moved = Math.hypot(dx, dz);
      if (moved > 1e-4) this.targetYaw = yawToward(dx, dz);
      this.group.position.x = nx;
      this.group.position.z = nz;
    } else if (this.path.length) {
      let remaining = this.travelSpeed() * dt;
      while (remaining > 0 && this.path.length) {
        const next = this.path[0];
        const dx = next.x - this.group.position.x;
        const dz = next.z - this.group.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= ARRIVE_EPSILON) {
          this.path.shift();
          continue;
        }
        this.targetYaw = yawToward(dx, dz);
        const step = Math.min(remaining, dist);
        this.group.position.x += (dx / dist) * step;
        this.group.position.z += (dz / dist) * step;
        remaining -= step;
        moved += step;
        if (step >= dist) this.path.shift();
      }
      // A creature that walks and swims changes pose at the shoreline.
      if (!this.locomotion.flies) {
        const now = this.mediumAt(this.group.position.x, this.group.position.z);
        if (now !== this.medium) {
          this.medium = now;
          this.setActivity(this.movingActivity());
        }
      }
      if (this.path.length === 0 && this.moveResolve) this.finishMove(true);
    }
    this.currentSpeed = dt > 0 ? moved / dt : 0;

    // Rise or settle toward the medium's height.
    const wantY = this.targetY();
    const dy = wantY - this.group.position.y;
    const maxClimb = CLIMB_SPEED * dt;
    this.group.position.y += Math.abs(dy) <= maxClimb ? dy : Math.sign(dy) * maxClimb;

    const turn = shortestAngle(this.yaw, this.targetYaw);
    const maxTurn = TURN_SPEED * dt;
    this.yaw += Math.abs(turn) <= maxTurn ? turn : Math.sign(turn) * maxTurn;
    this.group.rotation.y = this.yaw;

    if (this.sleepT !== this.sleepTarget) {
      const step = dt / SLEEP_EASE;
      this.sleepT = this.sleepTarget > this.sleepT ? Math.min(this.sleepTarget, this.sleepT + step) : Math.max(this.sleepTarget, this.sleepT - step);
      this.applySleepPose();
    }

    if (this.activity !== "sleep" && this.activity !== "faint" && this.loaded.poser.quirks.length) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.playOnce(this.loaded.poser.quirks[0]);
        this.blinkIn = 2.5 + Math.random() * 4;
      }
    }

    if (this.emoteLeft > 0) {
      this.emoteLeft -= dt;
      const t = EMOTE_SECONDS - this.emoteLeft;
      const pop = Math.min(1, t / 0.15);
      this.sprite.scale.setScalar(this.emoteSize * pop);
      this.sprite.position.y = this.emoteAnchorY + Math.sin(t * 3) * 0.04;
      if (this.emoteLeft <= 0) this.sprite.visible = false;
    }

    const resting = this.activity === "idle" || this.activity === "float" || this.activity === "hover";
    this.procedural.restore();
    this.mixer.update(dt);
    this.procedural.apply({
      dt,
      time: this.elapsed,
      speed: this.currentSpeed,
      scale: this.scale,
      lookTarget: resting && !this.isMoving ? lookTarget : null,
    });
    this.updateParticles(dt);
  }

  dispose(): void {
    this.cancelMove();
    this.procedural.restore();
    this.mixer.stopAllAction();
    this.particles?.dispose();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
    this.loaded.dispose();
  }
}
