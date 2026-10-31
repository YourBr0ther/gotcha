/**
 * Reads a Cobblemon JSON poser into a stack of layers per activity.
 *
 * A pose lists animations as Molang calls. `q.bedrock('eevee', 'ground_idle')`
 * names a keyframe clip (`animation.eevee.ground_idle` in the animation
 * file). The rest are Cobblemon built-ins the renderer computes every frame:
 * `q.look` turns a bone toward a target, `q.quadruped_walk` and
 * `q.biped_walk` swing legs with movement speed, `q.bimanual_swing` swings
 * arms, `q.sine_wing_flap` flaps wings. Quirks (`q.bedrock_quirk`) are
 * one-shot clips the creature plays now and then on top of everything.
 */

import type { PoserFile, PoserPose } from "./types";

/**
 * `float` and `hover` are the resting poses in water and in the air; the
 * rig picks them when a swimmer or flier stands still off the ground.
 */
export const ACTIVITIES = ["idle", "walk", "sleep", "swim", "float", "fly", "hover", "cry", "faint"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export type ProceduralSpec =
  | {
      kind: "look";
      bone: string;
      pitchMultiplier: number;
      yawMultiplier: number;
      /** Bedrock degrees; positive pitch looks down. */
      maxPitch: number;
      minPitch: number;
      maxYaw: number;
      minYaw: number;
    }
  | { kind: "quadruped_walk"; period: number; amplitude: number; legs: [string, string, string, string] }
  | { kind: "biped_walk"; period: number; amplitude: number; legs: [string, string] }
  | { kind: "bimanual_swing"; period: number; amplitude: number; arms: [string, string] }
  | {
      kind: "sine_wing_flap";
      amplitude: number;
      period: number;
      verticalShift: number;
      axis: "x" | "y" | "z";
      wings: [string, string];
    }
  | { kind: "unknown"; name: string; expr: string };

export interface PoseStack {
  /** Keyframe clips that play together, looped. */
  clips: string[];
  /** Built-ins layered over the clips every frame, in poser order. */
  procedural: ProceduralSpec[];
}

export interface PoserMap {
  poses: Partial<Record<Activity, PoseStack>>;
  /** One-shot clips. */
  cry?: string;
  faint?: string;
  /** Quirk clips (blink and the like). */
  quirks: string[];
}

const POSE_TYPES: Record<Activity, string[]> = {
  idle: ["STAND", "NONE", "PORTRAIT", "PROFILE"],
  walk: ["WALK"],
  sleep: ["SLEEP"],
  swim: ["SWIM", "FLOAT"],
  float: ["FLOAT", "SWIM"],
  fly: ["FLY", "HOVER"],
  hover: ["HOVER", "FLY"],
  cry: [],
  faint: [],
};

/** When a poser has no pose for an activity, try these in order. */
const FALLBACK: Record<Activity, Activity[]> = {
  idle: [],
  walk: ["idle"],
  sleep: ["idle"],
  swim: ["float", "walk", "idle"],
  float: ["swim", "idle"],
  fly: ["hover", "walk", "idle"],
  hover: ["fly", "idle"],
  cry: ["idle"],
  faint: ["sleep", "idle"],
};

export type CallArg = string | number;

export interface PoserCall {
  name: string;
  args: CallArg[];
}

/**
 * Split `q.name(a, 'b', q.nested('c'))` into its name and top-level args.
 * Quoted args become strings, numeric args numbers, and a nested call
 * contributes its first quoted string (enough for `q.array('a', 'b')`).
 */
export function parsePoserCall(expr: string): PoserCall | undefined {
  const open = expr.indexOf("(");
  const name = (open === -1 ? expr : expr.slice(0, open)).trim().toLowerCase();
  if (!/^(q|query)\.[a-z_]+$/.test(name)) return undefined;
  if (open === -1) return { name, args: [] };
  const close = expr.lastIndexOf(")");
  const inner = expr.slice(open + 1, close === -1 ? undefined : close);
  const raw: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      raw.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) raw.push(cur);
  const args: CallArg[] = [];
  for (const piece of raw) {
    const t = piece.trim();
    const quoted = /^'([^']*)'$|^"([^"]*)"$/.exec(t);
    if (quoted) {
      args.push(quoted[1] ?? quoted[2]);
      continue;
    }
    const n = Number(t);
    if (t !== "" && Number.isFinite(n)) {
      args.push(n);
      continue;
    }
    const nested = /'([^']+)'/.exec(t);
    args.push(nested ? nested[1] : t);
  }
  return { name, args };
}

function num(v: CallArg | undefined, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function str(v: CallArg | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** `q.bedrock('eevee', 'ground_idle')` -> `animation.eevee.ground_idle`. */
export function clipNameFromExpression(expr: string): string | undefined {
  const call = parsePoserCall(expr);
  if (!call || !call.name.startsWith("q.bedrock")) return undefined;
  const group = str(call.args[0]);
  const anim = str(call.args[1]);
  if (!group || !anim) return undefined;
  return `animation.${group}.${anim}`;
}

export function proceduralFromExpression(expr: string): ProceduralSpec | undefined {
  const call = parsePoserCall(expr);
  if (!call || call.name.startsWith("q.bedrock")) return undefined;
  const a = call.args;
  switch (call.name) {
    case "q.look":
      return {
        kind: "look",
        bone: str(a[0], "head"),
        pitchMultiplier: num(a[1], 1),
        yawMultiplier: num(a[2], 1),
        maxPitch: num(a[3], 70),
        minPitch: num(a[4], -45),
        maxYaw: num(a[5], 45),
        minYaw: num(a[6], -45),
      };
    case "q.quadruped_walk":
      return {
        kind: "quadruped_walk",
        period: num(a[0], 0.6662),
        amplitude: num(a[1], 1.4),
        legs: [str(a[2]), str(a[3]), str(a[4]), str(a[5])],
      };
    case "q.biped_walk":
      return { kind: "biped_walk", period: num(a[0], 0.6662), amplitude: num(a[1], 1.4), legs: [str(a[2]), str(a[3])] };
    case "q.bimanual_swing":
      return { kind: "bimanual_swing", period: num(a[0], 0.6662), amplitude: num(a[1], 1), arms: [str(a[2]), str(a[3])] };
    case "q.sine_wing_flap": {
      const axis = str(a[3], "z").toLowerCase();
      return {
        kind: "sine_wing_flap",
        amplitude: num(a[0], 1),
        period: num(a[1], 1),
        verticalShift: num(a[2], 0),
        axis: axis === "x" || axis === "y" ? axis : "z",
        wings: [str(a[4]), str(a[5])],
      };
    }
    default:
      return { kind: "unknown", name: call.name, expr };
  }
}

function pickClip(name: string, available?: Set<string>): string | undefined {
  if (!available) return name;
  if (available.has(name)) return name;
  // Tolerate a species prefix mismatch between poser and animation file.
  const suffix = name.slice(name.lastIndexOf("."));
  for (const candidate of available) if (candidate.endsWith(suffix)) return candidate;
  return undefined;
}

/**
 * Pose animation lists are strings, but a few posers carry
 * `{ animation, condition }` objects for riding and held items. Their
 * conditions (`q.is_ridden`, `q.is_holding_item`) are never true here, so
 * those entries are skipped.
 */
function animationExpressions(list: unknown[] | undefined): string[] {
  return (list ?? []).filter((entry): entry is string => typeof entry === "string");
}

function buildStack(animations: string[], available?: Set<string>): PoseStack {
  const stack: PoseStack = { clips: [], procedural: [] };
  for (const expr of animations) {
    const clip = clipNameFromExpression(expr);
    if (clip) {
      const picked = pickClip(clip, available);
      if (picked && !stack.clips.includes(picked)) stack.clips.push(picked);
      continue;
    }
    const spec = proceduralFromExpression(expr);
    if (spec) stack.procedural.push(spec);
  }
  return stack;
}

export function readPoser(poser: PoserFile, availableClips?: Iterable<string>): PoserMap {
  const available = availableClips ? new Set(availableClips) : undefined;
  const poses: Partial<Record<Activity, PoseStack>> = {};
  const quirks: string[] = [];
  const list = Object.values(poser.poses ?? {});

  // Cobblemon tags battle stances with isBattle (a boolean, or the string
  // "true" in a few hand-edited posers). Pikachu lists "battle-standing"
  // before "standing", both typed STAND, so taking the first match put him in
  // his fighting crouch on the lawn. Overworld poses win; a battle pose is
  // only used when nothing else carries the type.
  const isBattle = (p: PoserPose) => p.isBattle === true || (p.isBattle as unknown) === "true";
  for (const activity of ACTIVITIES) {
    for (const type of POSE_TYPES[activity]) {
      const typed = list.filter((p) => p.poseTypes?.includes(type));
      const pose = typed.find((p) => !isBattle(p)) ?? typed[0];
      if (!pose) continue;
      const stack = buildStack(animationExpressions(pose.animations), available);
      if (stack.clips.length || stack.procedural.length) {
        poses[activity] = stack;
        break;
      }
    }
  }

  const named = (poser.animations ?? {}) as Record<string, unknown>;
  const oneShot = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const expr = (poser[key] as unknown) ?? named[key];
      if (typeof expr !== "string") continue;
      const name = clipNameFromExpression(expr);
      const picked = name ? pickClip(name, available) : undefined;
      if (picked) return picked;
    }
    return undefined;
  };
  // Cobblemon's own posers leave out clips the animation file carries:
  // 111 species have a cry clip no poser names, 156 a faint, 61 a sleep.
  // When the poser is silent, a clip named for the job in the same group
  // as the idle clip stands in, which is what the synthesized posers do.
  const group = groupOf(poses.idle?.clips[0]);
  const byName = (job: string): string | undefined => {
    if (!available) return undefined;
    const exact = group ? `${group}.${job}` : undefined;
    if (exact && available.has(exact)) return exact;
    for (const candidate of available) if (candidate.endsWith(`.${job}`) && (!group || !candidate.startsWith("animation."))) return candidate;
    return undefined;
  };
  const cry = oneShot(["cry", "cryAnimation"]) ?? byName("cry");
  const faint = oneShot(["faint"]) ?? byName("faint");
  if (!poses.sleep) {
    const sleep = byName("sleep");
    if (sleep) poses.sleep = { clips: [sleep], procedural: [] };
  }

  for (const pose of list) {
    for (const expr of animationExpressions(pose.quirks)) {
      const name = clipNameFromExpression(expr);
      const picked = name ? pickClip(name, available) : undefined;
      if (picked && !quirks.includes(picked)) quirks.push(picked);
    }
  }

  return { poses, cry, faint, quirks };
}

/** `animation.eevee.ground_idle` -> `animation.eevee`; undefined without a dot. */
function groupOf(clip: string | undefined): string | undefined {
  if (!clip) return undefined;
  const i = clip.lastIndexOf(".");
  return i > 0 ? clip.slice(0, i) : undefined;
}

/** The layer stack for an activity, following the fallback chain. */
export function resolveActivity(map: PoserMap, activity: Activity): PoseStack | undefined {
  if (map.poses[activity]) return map.poses[activity];
  for (const alt of FALLBACK[activity]) {
    if (map.poses[alt]) return map.poses[alt];
  }
  return undefined;
}
