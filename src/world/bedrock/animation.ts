/**
 * Bedrock `.animation.json` to three.js AnimationClips.
 *
 * Bedrock animates by adding deltas to a bone's rest transform, and several
 * animations can add at once. The clips here use three.js's additive blend
 * mode so a track holds exactly that delta: rotation in radians with the
 * geometry sign convention, position in Bedrock units with X mirrored, and
 * scale minus one. The mixer adds them onto the rest pose captured when the
 * first action binds.
 *
 * Channels made only of numbers keep their exact keyframe times. A channel
 * with a time-dependent Molang expression, or a catmullrom keyframe, is
 * sampled at SAMPLE_HZ. An expression the interpreter cannot handle falls
 * back to 0 for that component and is logged once.
 */

import * as THREE from "three";
import { bedrockPositionDelta, bedrockRotationDelta } from "./geometry";
import { evaluateMolang, isTimeDependent, MolangUnsupported, warnOnce } from "./molang";
import type {
  BedrockAnimation,
  BedrockAnimationFile,
  BedrockChannel,
  BedrockKeyframe,
  BedrockKeyframeObject,
  MolangValue,
  MolangVec3,
  Vec3,
} from "./types";

export const SAMPLE_HZ = 20;

export type LoopMode = "repeat" | "once" | "hold";

export interface BedrockClip {
  name: string;
  clip: THREE.AnimationClip;
  loop: LoopMode;
}

interface Keyframe {
  time: number;
  pre: MolangVec3;
  post: MolangVec3;
  catmullrom: boolean;
}

type ChannelKind = "rotation" | "position" | "scale";

function toVec3(value: MolangVec3 | MolangValue | undefined, fallback: MolangValue): MolangVec3 {
  if (value === undefined) return [fallback, fallback, fallback];
  if (Array.isArray(value)) {
    return [value[0] ?? fallback, value[1] ?? fallback, value[2] ?? fallback];
  }
  return [value, value, value];
}

function isKeyframeObject(k: BedrockKeyframe): k is BedrockKeyframeObject {
  return typeof k === "object" && k !== null && !Array.isArray(k);
}

/** Normalise any channel form into sorted keyframes. */
export function parseChannel(channel: BedrockChannel, kind: ChannelKind): Keyframe[] {
  const identity: MolangValue = kind === "scale" ? 1 : 0;
  if (Array.isArray(channel) || typeof channel !== "object") {
    const v = toVec3(channel, identity);
    return [{ time: 0, pre: v, post: v, catmullrom: false }];
  }
  const frames: Keyframe[] = [];
  for (const [timeKey, raw] of Object.entries(channel)) {
    const time = parseFloat(timeKey);
    if (!Number.isFinite(time)) continue;
    if (isKeyframeObject(raw)) {
      const post = toVec3(raw.post ?? raw.pre, identity);
      const pre = raw.pre !== undefined ? toVec3(raw.pre, identity) : post;
      frames.push({ time, pre, post, catmullrom: raw.lerp_mode === "catmullrom" });
    } else {
      const v = toVec3(raw, identity);
      frames.push({ time, pre: v, post: v, catmullrom: false });
    }
  }
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

function evalComponent(value: MolangValue, time: number): number {
  if (typeof value === "number") return value;
  try {
    return evaluateMolang(value, { animTime: time, lifeTime: time });
  } catch (err) {
    if (err instanceof MolangUnsupported) {
      warnOnce(value, `${err.message}; using 0`);
      return 0;
    }
    throw err;
  }
}

function evalVec(v: MolangVec3, time: number): Vec3 {
  return [evalComponent(v[0], time), evalComponent(v[1], time), evalComponent(v[2], time)];
}

function componentIsDynamic(value: MolangValue): boolean {
  if (typeof value === "number") return false;
  try {
    return isTimeDependent(value);
  } catch {
    return false;
  }
}

function channelNeedsSampling(frames: Keyframe[]): boolean {
  for (const f of frames) {
    if (f.catmullrom) return true;
    for (const c of f.pre) if (componentIsDynamic(c)) return true;
    for (const c of f.post) if (componentIsDynamic(c)) return true;
  }
  return false;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Evaluate a channel at a time, in raw Bedrock units and degrees. */
export function sampleChannel(frames: Keyframe[], time: number): Vec3 {
  if (frames.length === 0) return [0, 0, 0];
  if (time <= frames[0].time) return evalVec(frames[0].pre, time);
  const last = frames[frames.length - 1];
  if (time >= last.time) return evalVec(last.post, time);

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].time <= time) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.time - a.time;
  const t = span > 0 ? (time - a.time) / span : 1;
  const va = evalVec(a.post, time);
  const vb = evalVec(b.pre, time);

  if (a.catmullrom || b.catmullrom) {
    const before = frames[i - 1] ?? a;
    const after = frames[i + 2] ?? b;
    const v0 = evalVec(before.post, time);
    const v3 = evalVec(after.pre, time);
    return [
      catmullRom(v0[0], va[0], vb[0], v3[0], t),
      catmullRom(v0[1], va[1], vb[1], v3[1], t),
      catmullRom(v0[2], va[2], vb[2], v3[2], t),
    ];
  }
  return [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
}

function toDelta(kind: ChannelKind, v: Vec3): Vec3 {
  switch (kind) {
    case "rotation":
      return bedrockRotationDelta(v);
    case "position":
      return bedrockPositionDelta(v);
    case "scale":
      return [v[0] - 1, v[1] - 1, v[2] - 1];
  }
}

interface Sampled {
  times: number[];
  values: Vec3[];
}

function sampleFrames(frames: Keyframe[], kind: ChannelKind, length: number): Sampled {
  const times: number[] = [];
  const values: Vec3[] = [];
  if (!channelNeedsSampling(frames)) {
    for (const f of frames) {
      const pre = toDelta(kind, evalVec(f.pre, f.time));
      const post = toDelta(kind, evalVec(f.post, f.time));
      const jump = pre.some((x, i) => x !== post[i]);
      if (jump && times.length > 0) {
        times.push(f.time);
        values.push(pre);
        times.push(f.time + 1e-4);
        values.push(post);
      } else {
        times.push(f.time);
        values.push(post);
      }
    }
    return { times, values };
  }
  const step = 1 / SAMPLE_HZ;
  const count = Math.max(1, Math.round(length * SAMPLE_HZ));
  for (let i = 0; i <= count; i++) {
    const t = Math.min(i * step, length);
    times.push(t);
    values.push(toDelta(kind, sampleChannel(frames, t)));
  }
  return { times, values };
}

function channelLength(channel: BedrockChannel | undefined): number {
  if (!channel || Array.isArray(channel) || typeof channel !== "object") return 0;
  let max = 0;
  for (const k of Object.keys(channel)) {
    const t = parseFloat(k);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

export function animationLength(anim: BedrockAnimation): number {
  if (anim.animation_length && anim.animation_length > 0) return anim.animation_length;
  let max = 0;
  for (const bone of Object.values(anim.bones ?? {})) {
    max = Math.max(max, channelLength(bone.rotation), channelLength(bone.position), channelLength(bone.scale));
  }
  return Math.max(max, 1 / SAMPLE_HZ);
}

export function loopMode(anim: BedrockAnimation): LoopMode {
  if (anim.loop === true) return "repeat";
  if (anim.loop === "hold_on_last_frame") return "hold";
  return "once";
}

export function buildClip(name: string, anim: BedrockAnimation): BedrockClip {
  const length = animationLength(anim);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, channels] of Object.entries(anim.bones ?? {})) {
    if (channels.rotation !== undefined) {
      const s = sampleFrames(parseChannel(channels.rotation, "rotation"), "rotation", length);
      (["x", "y", "z"] as const).forEach((axis, i) => {
        tracks.push(
          new THREE.NumberKeyframeTrack(
            `${bone}.rotation[${axis}]`,
            s.times,
            s.values.map((v) => v[i]),
          ),
        );
      });
    }
    if (channels.position !== undefined) {
      const s = sampleFrames(parseChannel(channels.position, "position"), "position", length);
      tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, s.times, s.values.flat()));
    }
    if (channels.scale !== undefined) {
      const s = sampleFrames(parseChannel(channels.scale, "scale"), "scale", length);
      tracks.push(new THREE.VectorKeyframeTrack(`${bone}.scale`, s.times, s.values.flat()));
    }
  }
  const clip = new THREE.AnimationClip(name, length, tracks, THREE.AdditiveAnimationBlendMode);
  const loop = loopMode(anim);
  clip.userData.loop = loop;
  return { name, clip, loop };
}

export function buildClips(file: BedrockAnimationFile): Map<string, BedrockClip> {
  const out = new Map<string, BedrockClip>();
  for (const [name, anim] of Object.entries(file.animations ?? {})) {
    out.set(name, buildClip(name, anim));
  }
  return out;
}

/** Map a BedrockClip loop mode onto an AnimationAction. */
export function applyLoop(action: THREE.AnimationAction, loop: LoopMode): void {
  if (loop === "repeat") {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  } else {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = loop === "hold";
  }
}
