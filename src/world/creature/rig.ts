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
 * Movement follows the species behaviour. A walker paths over the land
 * grid; a swimmer adds the water grid and sinks to a float height inside a
 * water volume; a water-only species is redirected to water spots; a flier
 * travels in a straight line at hover height and lands only on sleep spots.
 */

import * as THREE from "three";
import type { Activity, EmoteKind, PokemonBundle } from "../api";
import { applyLoop, buildClips, type BedrockClip } from "../bedrock/animation";
import { buildModel, type LoadedModel } from "../bedrock/geometry";
import { mergeBoneCubes } from "../bedrock/merge";
import { type PoserMap, type PoseStack, readPoser, resolveActivity } from "../bedrock/poser";
import { createBedrockMaterial, loadBedrockTexture, loadEmissiveTexture } from "../bedrock/texture";
import type { DioramaDef, Medium, Spot, WaterVolume } from "../dioramas/types";
import { cellToWorld, createNavGrid, findPath, type NavGrid, nearestWalkable, simplifyPath, worldToCell } from "../nav/grid";
import type { CreatureController } from "../store";
import { emoteTexture } from "./emotes";
import { ProceduralStack } from "./layers";
import { type Locomotion, readLocomotion, resolveSpot, spotMedium } from "./locomotion";

const WALK_SPEED = 1.7; // blocks per second at baseScale 1
const SWIM_FACTOR = 0.8;
const FLY_FACTOR = 1.3;
const CLIMB_SPEED = 1.6; // blocks per second up or down
const TURN_SPEED = 9; // radians per second
const FADE = 0.25;

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

export interface LoadedCreature {
  model: LoadedModel;
  clips: Map<string, BedrockClip>;
  poser: PoserMap;
  texture: THREE.Texture | null;
  emissive: THREE.Texture | null;
  material: THREE.Material;
  bundle: PokemonBundle;
  /** Draw calls the model costs: one per bone with cubes. */
  meshes: number;
  dispose(): void;
}

export async function loadCreature(bundle: PokemonBundle, aspects: string[]): Promise<LoadedCreature> {
  const shiny = aspects.includes("shiny") && bundle.textures.shiny;
  const url = shiny ? bundle.textures.shiny! : bundle.textures.base;
  let texture: THREE.Texture | null = null;
  let emissive: THREE.Texture | null = null;
  try {
    texture = await loadBedrockTexture(url);
  } catch (err) {
    console.warn(`[world] texture failed for ${bundle.species}, drawing untextured`, err);
  }
  if (bundle.textures.emissive) {
    try {
      emissive = await loadEmissiveTexture(bundle.textures.emissive);
    } catch (err) {
      console.warn(`[world] emissive texture failed for ${bundle.species}, drawing without glow`, err);
    }
  }
  const material = createBedrockMaterial(texture, emissive);
  const model = buildModel(bundle.geometry, material);
  const meshes = mergeBoneCubes(model);
  const clips = buildClips(bundle.animations);
  // Riding clips animate seat locators the geometry does not carry; the
  // mixer would warn on every such track, so drop them up front.
  for (const clip of clips.values()) {
    clip.clip.tracks = clip.clip.tracks.filter((t) => model.bones.has(t.name.slice(0, t.name.indexOf("."))));
  }
  const poser = readPoser(bundle.poser, clips.keys());
  return {
    model,
    clips,
    poser,
    texture,
    emissive,
    material,
    bundle,
    meshes,
    dispose() {
      model.dispose();
      material.dispose();
      texture?.dispose();
      emissive?.dispose();
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

export class CreatureRig implements CreatureController {
  readonly group = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  /** Height of the model in blocks after baseScale, for framing. */
  readonly height: number;
  readonly locomotion: Locomotion;

  private readonly actions = new Map<string, THREE.AnimationAction>();
  private baseClips: string[] = [];
  private procedural: ProceduralStack;
  private activity: Activity = "idle";
  private diorama: DioramaDef;
  private grid: NavGrid;
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

  constructor(readonly loaded: LoadedCreature, diorama: DioramaDef) {
    this.diorama = diorama;
    this.locomotion = readLocomotion(loaded.bundle.behaviour);
    this.grid = travelGrid(diorama, this.locomotion);
    const scale = loaded.bundle.baseScale ?? 1;
    this.scale = scale;
    loaded.model.root.scale.multiplyScalar(scale);
    this.group.add(loaded.model.root);
    this.height = Math.max(0.3, loaded.model.bounds.max.y * scale);
    this.mixer = new THREE.AnimationMixer(loaded.model.root);
    this.bones = new Map(loaded.model.bones);
    this.procedural = new ProceduralStack(this.bones, loaded.model.root, []);

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
    return action;
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
      return;
    }
    if (activity === "idle") {
      this.landed = false;
      this.medium = this.mediumAt(this.group.position.x, this.group.position.z);
      this.setActivity(this.restingActivity());
      return;
    }
    this.setActivity(activity);
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

  moveTo(spot: string): Promise<boolean> {
    const name = resolveSpot(this.diorama.spots, spot, this.locomotion);
    if (!name) {
      console.warn(`[world] no spot named ${spot} in ${this.diorama.id}`);
      return Promise.resolve(false);
    }
    const target = this.diorama.spots[name];
    this.cancelMove();
    this.orbit = null;
    this.arriveFacing = target.facing;

    if (this.locomotion.flies) {
      // Take off, fly straight there, and land only on a sleep spot.
      this.landed = false;
      this.medium = "air";
      this.hoverY = spotMedium(target) === "air" && target.y !== undefined ? target.y : this.defaultHoverY();
      this.path = [{ x: target.x, z: target.z }];
      this.landOnArrival = name.startsWith("sleep");
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
    this.orbit = orbit;
    if (orbit) {
      this.landed = false;
      this.medium = "air";
      this.hoverY = orbit.y;
      this.orbitAngle = Math.atan2(this.group.position.z - orbit.z, this.group.position.x - orbit.x);
      this.setActivity("fly");
    }
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
  update(dt: number, lookTarget: THREE.Vector3 | null = null): void {
    this.elapsed += dt;
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
  }

  dispose(): void {
    this.cancelMove();
    this.procedural.restore();
    this.mixer.stopAllAction();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
    this.loaded.dispose();
  }
}
