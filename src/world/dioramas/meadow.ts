/**
 * The meadow: a flat lawn in front, a pond on the right, a fallen log on
 * the left, stepped ground and a wall of trees at the back. Built once from
 * a seeded generator so the layout is the same on every load.
 */

import type { BlockId } from "../blocks/palette";
import { createNavGrid, isWalkable, setWalkable } from "../nav/grid";
import type { BlockInstance, DioramaDef, Spot, WaterPatch } from "./types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN_X = -14;
const MAX_X = 13;
const MIN_Z = -22;
const MAX_Z = 7;

const POND = { x: 3, z: -8, w: 5, d: 4 };

const TREES: Array<[number, number]> = [
  [-11, -19],
  [-6, -20],
  [-1, -19],
  [4, -20],
  [9, -19],
  [13, -18],
  [-13, -11],
  [-13, -3],
  [13, -10],
  [12, -2],
];

function groundHeight(x: number, z: number): number {
  let h = 0;
  if (z <= -12) h = 1;
  if (z <= -16) h = 2;
  if (x >= 9 && z <= -6 && z > -12) h = 1;
  if (x <= -12 && z <= -5 && z > -12) h = 1;
  return h;
}

function inPond(x: number, z: number): boolean {
  return x >= POND.x && x < POND.x + POND.w && z >= POND.z && z < POND.z + POND.d;
}

export function buildMeadow(): DioramaDef {
  const rand = mulberry32(20261030);
  const blocks: BlockInstance[] = [];
  const nav = createNavGrid(MIN_X, MIN_Z, MAX_X - MIN_X + 1, MAX_Z - MIN_Z + 1);
  const block = (b: BlockId, x: number, y: number, z: number, extra: Partial<BlockInstance> = {}) =>
    blocks.push({ block: b, x, y, z, ...extra });

  // Ground.
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    for (let x = MIN_X; x <= MAX_X; x++) {
      const h = groundHeight(x, z);
      if (inPond(x, z)) {
        block("sand", x, -1, z);
        continue;
      }
      const tint = 0.94 + rand() * 0.1;
      block("grass", x, h - 1, z, { tint: tint * 0xffffff > 0 ? mixTint(tint) : undefined });
      // Expose dirt on any step face a neighbour reveals.
      const neighbours = [groundHeight(x + 1, z), groundHeight(x - 1, z), groundHeight(x, z + 1), groundHeight(x, z - 1)];
      const lowest = Math.min(...neighbours);
      for (let y = lowest; y < h - 1; y++) block("dirt", x, y, z);
      if (h === 0) setWalkable(nav, x - MIN_X, z - MIN_Z, true);
    }
  }

  // Pond rim: a step of sand on the near side so the water reads.
  const water: WaterPatch[] = [{ x: POND.x, z: POND.z, w: POND.w, d: POND.d, y: -0.2 }];

  // Trees.
  for (const [tx, tz] of TREES) {
    const base = groundHeight(tx, tz);
    const height = 4 + Math.floor(rand() * 2);
    for (let y = 0; y < height; y++) block("log", tx, base + y, tz);
    setWalkable(nav, tx - MIN_X, tz - MIN_Z, false);
    const top = base + height;
    for (let dy = -1; dy <= 1; dy++) {
      const r = dy === 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.6) continue;
          if (dx === 0 && dz === 0 && dy < 1) continue;
          const leaf: BlockId = rand() < 0.3 ? "leaves_light" : "leaves";
          block(leaf, tx + dx, top + dy, tz + dz);
        }
      }
    }
    block("leaves", tx, top + 2, tz);
    if (rand() < 0.5) block("leaves_light", tx + (rand() < 0.5 ? 1 : -1), top + 2, tz);
  }

  // Bushes.
  const bushes: Array<[number, number]> = [
    [-8, -8],
    [-7, -8],
    [-8, -9],
    [8, -2],
    [-4, -9],
    [-4, -14],
    [-3, -14],
    [6, -14],
    [10, -8],
  ];
  for (const [bx, bz] of bushes) {
    const h = groundHeight(bx, bz);
    block(rand() < 0.5 ? "leaves" : "leaves_light", bx, h, bz);
    setWalkable(nav, bx - MIN_X, bz - MIN_Z, false);
  }

  // Rocks.
  const rocks: Array<[number, number, number]> = [
    [7, -12, 0],
    [8, -12, 0],
    [8, -12, 1],
    [-9, -15, 0],
    [-10, -15, 0],
    [9, 1, 0],
    [-11, 2, 0],
  ];
  for (const [rx, rz, ry] of rocks) {
    const h = groundHeight(rx, rz);
    block("stone", rx, h + ry, rz, { tint: 0xdcdcdc + Math.floor(rand() * 0x202020) });
    setWalkable(nav, rx - MIN_X, rz - MIN_Z, false);
  }

  // A fallen log on the left, lying along X.
  for (let lx = -9; lx <= -6; lx++) {
    block("log", lx, 0, -1, { rotationY: 0 });
    setWalkable(nav, lx - MIN_X, -1 - MIN_Z, false);
  }

  // Pond is not walkable.
  for (let z = POND.z; z < POND.z + POND.d; z++) {
    for (let x = POND.x; x < POND.x + POND.w; x++) setWalkable(nav, x - MIN_X, z - MIN_Z, false);
  }

  // The portrait camera sees a narrow wedge along -Z from the play spot, so
  // every spot stays within roughly a fifth of its distance from that line.
  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -3.5, facing: Math.PI / 2 },
    forage_2: { x: -1.5, z: -8.5, facing: -Math.PI / 2 + 0.6 },
    sleep_1: { x: 3.5, z: -10.5, facing: Math.PI + 0.5 },
  };

  // Keep spots and the spawn clear of decoration.
  const reserved = new Set<string>();
  for (const s of Object.values(spots)) reserved.add(`${Math.floor(s.x)},${Math.floor(s.z)}`);

  // Flowers and tufts on free lawn cells.
  const flowerKinds: BlockId[] = ["flower_white", "flower_pink", "flower_yellow"];
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    for (let x = MIN_X; x <= MAX_X; x++) {
      if (!isWalkable(nav, x - MIN_X, z - MIN_Z)) continue;
      if (reserved.has(`${x},${z}`)) continue;
      const r = rand();
      if (r < 0.06) {
        const kind = flowerKinds[Math.floor(rand() * flowerKinds.length)];
        const ox = x + 0.3 + rand() * 0.4;
        const oz = z + 0.3 + rand() * 0.4;
        block("stem", ox, 0, oz);
        block(kind, ox, 0.42, oz);
        setWalkable(nav, x - MIN_X, z - MIN_Z, false);
      } else if (r < 0.2) {
        block("tuft", x + 0.2 + rand() * 0.6, 0, z + 0.2 + rand() * 0.6, { tint: mixTint(0.9 + rand() * 0.2) });
      }
    }
  }

  return {
    id: "meadow",
    blocks,
    water,
    spots,
    nav,
    spawn: spots.play_1,
  };
}

function mixTint(f: number): number {
  const v = Math.max(0, Math.min(255, Math.round(255 * f)));
  return (v << 16) | (v << 8) | v;
}

let cached: DioramaDef | null = null;
export function meadow(): DioramaDef {
  if (!cached) cached = buildMeadow();
  return cached;
}
