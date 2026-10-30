/**
 * A loaded creature in the scene: model, mixer, layer stack, movement along
 * the navmesh, emote bubble, cry. The React component owns one of these
 * and calls `update` every frame. It also serves as the store's
 * CreatureController.
 *
 * A pose is a stack: the poser's keyframe clips play together through the
 * mixer (additively, on the rest pose), the procedural layers (walk swing,
 * head look) are added each frame on top, and quirks (blink) fire as
 * one-shot clips over everything.
 */

import * as THREE from "three";
import type { Activity, EmoteKind, PokemonBundle } from "../api";
import { applyLoop, buildClips, type BedrockClip } from "../bedrock/animation";
import { buildModel, type LoadedModel } from "../bedrock/geometry";
import { type PoserMap, type PoseStack, readPoser, resolveActivity } from "../bedrock/poser";
import { createBedrockMaterial, loadBedrockTexture } from "../bedrock/texture";
import type { DioramaDef, Spot } from "../dioramas/types";
import { cellToWorld, findPath, nearestWalkable, simplifyPath, worldToCell } from "../nav/grid";
import type { CreatureController } from "../store";
import { emoteTexture } from "./emotes";
import { ProceduralStack } from "./layers";

const WALK_SPEED = 1.7; // blocks per second at baseScale 1
const TURN_SPEED = 9; // radians per second
const FADE = 0.25;
const EMOTE_SECONDS = 1.8;
const ARRIVE_EPSILON = 0.05;

export interface LoadedCreature {
  model: LoadedModel;
  clips: Map<string, BedrockClip>;
  poser: PoserMap;
  texture: THREE.Texture | null;
  material: THREE.Material;
  bundle: PokemonBundle;
  dispose(): void;
}

export async function loadCreature(bundle: PokemonBundle, aspects: string[]): Promise<LoadedCreature> {
  const shiny = aspects.includes("shiny") && bundle.textures.shiny;
  const url = shiny ? bundle.textures.shiny! : bundle.textures.base;
  let texture: THREE.Texture | null = null;
  try {
    texture = await loadBedrockTexture(url);
  } catch (err) {
    console.warn(`[world] texture failed for ${bundle.species}, drawing untextured`, err);
  }
  const material = createBedrockMaterial(texture);
  const model = buildModel(bundle.geometry, material);
  const clips = buildClips(bundle.animations);
  const poser = readPoser(bundle.poser, clips.keys());
  return {
    model,
    clips,
    poser,
    texture,
    material,
    bundle,
    dispose() {
      model.dispose();
      material.dispose();
      texture?.dispose();
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

export class CreatureRig implements CreatureController {
  readonly group = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  /** Height of the model in blocks after baseScale, for framing. */
  readonly height: number;

  private readonly actions = new Map<string, THREE.AnimationAction>();
  private baseClips: string[] = [];
  private procedural: ProceduralStack;
  private activity: Activity = "idle";
  private diorama: DioramaDef;
  private path: Array<{ x: number; z: number }> = [];
  private moveResolve: ((ok: boolean) => void) | null = null;
  private arriveFacing: number | undefined;
  private yaw = Math.PI;
  private targetYaw = Math.PI;
  private readonly speed: number;
  private readonly scale: number;
  private currentSpeed = 0;
  private blinkIn = 2 + Math.random() * 4;
  private readonly sprite: THREE.Sprite;
  private emoteLeft = 0;
  private emoteAnchorY: number;
  private readonly emoteSize: number;
  private audio: HTMLAudioElement | null = null;
  private readonly bones: Map<string, THREE.Object3D>;

  constructor(readonly loaded: LoadedCreature, diorama: DioramaDef) {
    this.diorama = diorama;
    const scale = loaded.bundle.baseScale ?? 1;
    this.scale = scale;
    loaded.model.root.scale.multiplyScalar(scale);
    this.group.add(loaded.model.root);
    this.height = Math.max(0.3, loaded.model.bounds.max.y * scale);
    this.speed = WALK_SPEED * Math.max(0.5, scale);
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

    this.teleport(diorama.spawn);
    this.setActivity("idle", true);
  }

  setDiorama(diorama: DioramaDef): void {
    this.cancelMove();
    this.diorama = diorama;
    this.teleport(diorama.spawn);
  }

  teleport(spot: Spot): void {
    this.group.position.set(spot.x, 0, spot.z);
    if (spot.facing !== undefined) {
      this.yaw = spot.facing;
      this.targetYaw = spot.facing;
      this.group.rotation.y = this.yaw;
    }
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
      if (this.baseClips.includes(name) && action.isRunning()) continue;
      action.reset();
      action.enabled = true;
      action.setEffectiveTimeScale(1);
      if (immediate) action.setEffectiveWeight(1);
      else action.setEffectiveWeight(0).fadeIn(FADE);
      action.play();
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
    if (activity === "cry") {
      this.cry();
      return;
    }
    if (activity === "faint") {
      this.activity = "faint";
      // Fall from whatever pose we were in; the faint clip holds its last frame.
      if (!this.playOnce(this.loaded.poser.faint, true)) this.setActivity("faint");
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
    const target = this.diorama.spots[spot];
    if (!target) {
      console.warn(`[world] no spot named ${spot} in ${this.diorama.id}`);
      return Promise.resolve(false);
    }
    this.cancelMove();
    const grid = this.diorama.nav;
    const from = nearestWalkable(grid, worldToCell(grid, this.group.position.x, this.group.position.z));
    const to = nearestWalkable(grid, worldToCell(grid, target.x, target.z));
    if (!from || !to) return Promise.resolve(false);
    const cells = findPath(grid, from, to);
    if (!cells) return Promise.resolve(false);
    const points = simplifyPath(cells).map((c) => cellToWorld(grid, c));
    // Finish exactly on the spot rather than the cell centre.
    points.push({ x: target.x, z: target.z });
    this.path = points.slice(1);
    this.arriveFacing = target.facing;
    if (this.path.length === 0) {
      this.finishMove(true);
      return Promise.resolve(true);
    }
    this.setActivity("walk");
    return new Promise((resolve) => {
      this.moveResolve = resolve;
    });
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
    return this.path.length > 0;
  }

  get currentActivity(): Activity {
    return this.activity;
  }

  private finishMove(ok: boolean): void {
    const resolve = this.moveResolve;
    this.moveResolve = null;
    this.path = [];
    if (this.arriveFacing !== undefined) this.targetYaw = this.arriveFacing;
    this.setActivity("idle");
    resolve?.(ok);
  }

  /** Advance one frame. `lookTarget` is the world point the look layer aims at while idle. */
  update(dt: number, lookTarget: THREE.Vector3 | null = null): void {
    let moved = 0;
    if (this.path.length) {
      let remaining = this.speed * dt;
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
      if (this.path.length === 0 && this.moveResolve) this.finishMove(true);
    }
    this.currentSpeed = dt > 0 ? moved / dt : 0;

    const turn = shortestAngle(this.yaw, this.targetYaw);
    const maxTurn = TURN_SPEED * dt;
    this.yaw += Math.abs(turn) <= maxTurn ? turn : Math.sign(turn) * maxTurn;
    this.group.rotation.y = this.yaw;

    if ((this.activity === "idle" || this.activity === "walk") && this.loaded.poser.quirks.length) {
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

    this.procedural.restore();
    this.mixer.update(dt);
    this.procedural.apply({
      dt,
      speed: this.currentSpeed,
      scale: this.scale,
      lookTarget: this.activity === "idle" && !this.isMoving ? lookTarget : null,
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
