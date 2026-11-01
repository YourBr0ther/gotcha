/**
 * Where an ambient visitor comes from, what it does, and where it leaves.
 * Pure planning over the diorama and the visitor's travel grid, so the
 * routes can be tested without a scene. Every number comes from `rand`,
 * which is what keeps two visits from looking alike.
 *
 * A ground visitor (walker or swimmer) appears at the rim of its grid far
 * from the active pokemon, wanders between random cells and the odd named
 * spot behind the subject, and leaves by another rim cell. A flier enters
 * from outside the air volume on one side, either circles once or twice at
 * a random spot and height, or just crosses the scene, and exits on another
 * side.
 *
 * The stage. The home camera stands close behind the subject looking down
 * -Z with a narrow portrait frame, and the subject's own body hides the
 * strip of ground straight behind it all the way to the backdrop. What a
 * phone can see of the ground is two flanks: inside the frame's wedge but
 * outside the hidden strip. Ground routes stay on those flanks, so a
 * visitor is on screen for most of its stay; fliers pass above the subject
 * and only need the wedge.
 */

import type { Orbit } from "../creature/rig";
import type { AirVolume, DioramaDef, Spot } from "../dioramas/types";
import { cellToWorld, findPath, isWalkable, type NavGrid, nearestWalkable, worldToCell } from "../nav/grid";
import type { AmbientRole } from "./candidates";

export type Rand = () => number;

export interface Point {
  x: number;
  z: number;
}

export type Keep = (x: number, z: number) => boolean;

/** World centres of the walkable cells that pass `keep`. */
export function cellsWhere(grid: NavGrid, keep: Keep = () => true): Point[] {
  const out: Point[] = [];
  for (let cz = 0; cz < grid.depth; cz++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (!isWalkable(grid, cx, cz)) continue;
      const p = cellToWorld(grid, { cx, cz });
      if (keep(p.x, p.z)) out.push(p);
    }
  }
  return out;
}

/** Walkable cells with an unwalkable or missing four-neighbour: the rim of the ground, or the shoreline of the water grid. */
export function rimCells(grid: NavGrid, keep: Keep = () => true): Point[] {
  return cellsWhere(grid, keep).filter((p) => {
    const c = worldToCell(grid, p.x, p.z);
    return !isWalkable(grid, c.cx - 1, c.cz) || !isWalkable(grid, c.cx + 1, c.cz) || !isWalkable(grid, c.cx, c.cz - 1) || !isWalkable(grid, c.cx, c.cz + 1);
  });
}

/** A random member of `cells` that a path reaches from `from`, trying a few before giving up. */
export function reachable(grid: NavGrid, from: Point, cells: Point[], rand: Rand, tries = 6): Point | null {
  if (cells.length === 0) return null;
  const start = nearestWalkable(grid, worldToCell(grid, from.x, from.z));
  if (!start) return null;
  for (let i = 0; i < tries; i++) {
    const p = cells[Math.floor(rand() * cells.length)];
    const goal = worldToCell(grid, p.x, p.z);
    if (findPath(grid, start, goal)) return p;
  }
  return null;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** How far behind the subject the portrait camera stands for a creature of reference height. */
const CAMERA_BACK = 2.75;
/** Tangent of half the portrait frame's horizontal angle, and of the half angle the subject's body covers. */
const FRAME = 0.27;
const HIDDEN = 0.15;

/** Inside the portrait frame and behind the subject, where a flier is seen above it. */
export function inFrame(subject: Point): Keep {
  return (x, z) => {
    if (z >= subject.z - 1.5) return false;
    const depth = subject.z + CAMERA_BACK - z;
    return Math.abs(x - subject.x) < FRAME * depth;
  };
}

/** The two visible flanks of the ground: in the frame, clear of the strip the subject hides, and well behind it. */
export function onStage(subject: Point): Keep {
  return (x, z) => {
    if (z >= subject.z - 2.5) return false;
    const depth = subject.z + CAMERA_BACK - z;
    const dx = Math.abs(x - subject.x);
    return dx > HIDDEN * depth && dx < FRAME * depth;
  };
}

export interface GroundPlan {
  kind: "ground";
  entry: Spot;
  exit: Spot;
  /** Named spots behind the subject this visitor may stop at between random cells. */
  haunts: Spot[];
  keep: Keep;
  subject: Point;
}

/** Wander targets prefer ground within this many blocks behind the subject, where a visitor is still big on screen. */
const NEAR_STAGE = 10;

export interface OrbitPlan {
  kind: "orbit";
  entry: Spot;
  /** The first point inside the volume; the orbit starts from there. */
  approach: Spot;
  orbits: Orbit[];
  exit: Spot;
}

export interface PassPlan {
  kind: "pass";
  entry: Spot;
  waypoints: Spot[];
  exit: Spot;
}

export type VisitPlan = GroundPlan | OrbitPlan | PassPlan;

/** Distance from the subject a ground visitor prefers to appear at; relaxed when the grid is small. */
const FAR = [7, 5, 3];

export function planGround(def: Pick<DioramaDef, "spots" | "framing">, grid: NavGrid, rand: Rand): GroundPlan | null {
  const subject = def.framing.subject;
  const keep = onStage(subject);
  // Only ground the subject's own region reaches: a pocket on top of a rock
  // or across a stream would strand the visitor somewhere odd.
  const home = nearestWalkable(grid, worldToCell(grid, subject.x, subject.z));
  const reached = (p: Point) => !home || findPath(grid, home, worldToCell(grid, p.x, p.z)) !== null;
  let rim: Point[] = [];
  for (const far of FAR) {
    rim = rimCells(grid, (x, z) => keep(x, z) && dist({ x, z }, subject) >= far).filter(reached);
    if (rim.length >= 2) break;
  }
  if (rim.length === 0) rim = cellsWhere(grid, keep).filter(reached);
  if (rim.length === 0) return null;
  const entry = rim[Math.floor(rand() * rim.length)];
  const away = rim.filter((p) => dist(p, entry) >= 4);
  const exit = reachable(grid, entry, away.length ? away : rim, rand) ?? entry;
  const haunts = Object.entries(def.spots)
    .filter(([name, s]) => /^(forage|ambient)_/.test(name) && keep(s.x, s.z) && isWalkable(grid, ...cellOf(grid, s)))
    .map(([, s]) => s);
  return { kind: "ground", entry: { ...entry }, exit: { ...exit }, haunts, keep, subject };
}

function cellOf(grid: NavGrid, p: Point): [number, number] {
  const c = worldToCell(grid, p.x, p.z);
  return [c.cx, c.cz];
}

/** The next place a ground visitor wanders to: a haunt now and then, otherwise a random reachable cell, near the subject when there are any. */
export function nextWanderTarget(plan: GroundPlan, grid: NavGrid, from: Point, rand: Rand): Spot | null {
  if (plan.haunts.length && rand() < 0.35) return plan.haunts[Math.floor(rand() * plan.haunts.length)];
  const cells = cellsWhere(grid, (x, z) => plan.keep(x, z) && dist({ x, z }, from) >= 2);
  const near = cells.filter((c) => c.z >= plan.subject.z - NEAR_STAGE);
  const p = reachable(grid, from, near.length >= 4 ? near : cells, rand);
  return p ? { x: p.x, z: p.z } : null;
}

type Side = "left" | "right" | "back";

/** A point just outside the air volume on one side, at a random height and position along it. */
function outside(air: AirVolume, side: Side, rand: Rand, y: number): Spot {
  const pad = 2.5;
  const alongX = air.x + air.w * (0.25 + rand() * 0.5);
  const alongZ = air.z + air.d * (0.2 + rand() * 0.5);
  if (side === "left") return { x: air.x - pad, z: alongZ, y, medium: "air" };
  if (side === "right") return { x: air.x + air.w + pad, z: alongZ, y, medium: "air" };
  return { x: alongX, z: air.z - pad, y, medium: "air" };
}

/** The lower half of the volume: high enough to clear the subject's head, low enough to stay under the tree canopy. */
function heightIn(air: AirVolume, rand: Rand): number {
  const lo = air.yMin + 0.3;
  const hi = Math.max(lo, air.yMin + (air.yMax - air.yMin) * 0.55);
  return lo + rand() * (hi - lo);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A point inside the air volume and inside the frame's wedge, `inset` blocks clear of the volume's sides, in the nearer half where the sky is open in front of the trees. */
function framedPoint(air: AirVolume, subject: Point, rand: Rand, inset: number): Point {
  const z = clamp(air.z + air.d * (0.4 + rand() * 0.5), air.z + inset, air.z + air.d - inset);
  const half = FRAME * 0.8 * (subject.z + CAMERA_BACK - z);
  const x = clamp(subject.x + (rand() * 2 - 1) * half, air.x + inset, air.x + air.w - inset);
  return { x, z };
}

function randomOrbit(air: AirVolume, subject: Point, rand: Rand, y: number): Orbit {
  const radius = Math.max(0.8, Math.min(air.w, air.d) * (0.12 + rand() * 0.16));
  const c = framedPoint(air, subject, rand, radius);
  return { x: c.x, z: c.z, y, radius, speed: (0.3 + rand() * 0.35) * (rand() < 0.5 ? 1 : -1) };
}

export function planFlight(def: Pick<DioramaDef, "air" | "framing">, rand: Rand): OrbitPlan | PassPlan | null {
  const air = def.air[0];
  if (!air) return null;
  const subject = def.framing.subject;
  const sides: Side[] = ["left", "right", "back"];
  const from = sides[Math.floor(rand() * sides.length)];
  const others = sides.filter((s) => s !== from);
  const to = others[Math.floor(rand() * others.length)];
  const y = heightIn(air, rand);
  const entry = outside(air, from, rand, y);
  const exit = outside(air, to, rand, heightIn(air, rand));
  if (rand() < 0.3) {
    // A fly-through: in one side, past a point or two inside, out another.
    const count = 1 + Math.floor(rand() * 2);
    const waypoints: Spot[] = [];
    for (let i = 0; i < count; i++) {
      waypoints.push({ ...framedPoint(air, subject, rand, 0.5), y: heightIn(air, rand), medium: "air" });
    }
    return { kind: "pass", entry, waypoints, exit };
  }
  const first = randomOrbit(air, subject, rand, y);
  const orbits = [first];
  if (rand() < 0.5) orbits.push(randomOrbit(air, subject, rand, heightIn(air, rand)));
  const approach: Spot = { x: first.x + first.radius, z: first.z, y, medium: "air" };
  return { kind: "orbit", entry, approach, orbits, exit };
}

export function planVisit(def: Pick<DioramaDef, "spots" | "framing" | "air">, grid: NavGrid, role: AmbientRole, rand: Rand): VisitPlan | null {
  return role === "flier" ? planFlight(def, rand) : planGround(def, grid, rand);
}

/** Seconds, before `tempo` scales them. */
export const TIMING = {
  firstVisit: [4, 10],
  stay: [25, 50],
  gap: [40, 90],
  pause: [1.5, 5],
} as const;

export function between(range: readonly [number, number], rand: Rand): number {
  return range[0] + rand() * (range[1] - range[0]);
}
