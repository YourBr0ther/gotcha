/**
 * The meadow, composed against the concept render: a lawn in front with
 * daisies and pink flowers, a fallen log on the left, a stream coming down
 * from the back terrace over a two-block waterfall into a pool just behind
 * the subject, draining off to the right, a stone outcrop either side of
 * the fall, mushrooms under the trees, and tall layered trees closing the
 * back.
 */

import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, Spot } from "./types";

/** The pool the fall lands in, right behind the subject. */
const POOL = { x: 1, z: -11, w: 5, d: 4 };
/** The brook that drains the pool off to the right. */
const BROOK = { x: 6, z: -9, w: 8, d: 2 };
/** The channel on the upper terrace that feeds the fall. */
const CHANNEL = { x: 2, z: -22, w: 3, d: 11 };
/** Stone shoulders either side of the channel where it reaches the drop. */
const OUTCROP = { x: 0, z: -16, w: 7, d: 5 };

const TREES: Array<[number, number, number]> = [
  // x, z, canopy radius
  [-8, -20, 3],
  [-3, -21, 3],
  [3, -20, 2],
  [8, -21, 3],
  [12, -19, 2],
  [-5, -15, 3],
  [-10, -13, 2],
  [-13, -6, 3],
  [10, -14, 3],
  [13, -7, 2],
  [-9, -4, 2],
];

function inRect(r: { x: number; z: number; w: number; d: number }, x: number, z: number): boolean {
  return x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d;
}

function inWater(x: number, z: number): boolean {
  return inRect(POOL, x, z) || inRect(BROOK, x, z);
}

function inOutcrop(x: number, z: number): boolean {
  return inRect(OUTCROP, x, z);
}

function inChannel(x: number, z: number): boolean {
  return inRect(CHANNEL, x, z);
}

function groundHeight(x: number, z: number): number {
  if (inWater(x, z)) return 0;
  if (inOutcrop(x, z)) return 2;
  let h = 0;
  if (z <= -12) h = 1;
  if (z <= -17) h = 2;
  if (x >= 10 && z <= -4 && z > -12) h = 1;
  if (x <= -12 && z <= -3 && z > -12) h = 1;
  return h;
}

export function buildMeadow(): DioramaDef {
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261030);

  s.forEachCell((x, z) => {
    if (inWater(x, z)) {
      s.block("sand", x, -2, z, { tint: mixTint(0.9 + s.rand() * 0.1) });
      return;
    }
    if (inChannel(x, z)) {
      // The stream bed sits one block below the terrace it runs through.
      s.block("stone", x, 0, z, { tint: mixTint(0.8 + s.rand() * 0.1) });
      for (let y = -1; y < 0; y++) s.block("stone", x, y, z);
      return;
    }
    const h = groundHeight(x, z);
    if (inOutcrop(x, z)) {
      const r = s.rand();
      s.column(r < 0.3 ? "stone_mossy" : r < 0.5 ? "grass" : "stone", "stone", x, z, h, groundHeight, mixTint(0.9 + s.rand() * 0.15));
      return;
    }
    s.column("grass", "dirt", x, z, h, groundHeight, mixTint(0.94 + s.rand() * 0.1));
    if (h === 0) s.walkable(x, z, true);
  });

  s.addWater({ x: POOL.x, z: POOL.z, w: POOL.w, d: POOL.d, y: -0.2, depth: 0.75 });
  s.addWater({ x: BROOK.x, z: BROOK.z, w: BROOK.w, d: BROOK.d, y: -0.2, depth: 0.75 });
  s.addWater({ x: CHANNEL.x, z: CHANNEL.z, w: CHANNEL.w, d: CHANNEL.d, y: 1.75, depth: 0.7, swimmable: false });
  s.addFalls({ x: CHANNEL.x, z: CHANNEL.z + CHANNEL.d, w: CHANNEL.w, top: 1.75, bottom: -0.3 });
  s.addAir({ x: -6, z: -14, w: 12, d: 16, yMin: 0.9, yMax: 4.5 });

  // Loose stones at the lip of the fall and round the pool.
  const stones: Array<[number, number, number]> = [
    [1, -12, 2],
    [5, -12, 2],
    [0, -12, 1],
    [6, -12, 1],
    [0, -8, 0],
    [6, -11, 0],
    [7, -7, 0],
    [-1, -11, 0],
  ];
  for (const [rx, rz, ry] of stones) {
    if (ry === 0) s.walkable(rx, rz, false);
    s.block(s.rand() < 0.4 ? "stone_mossy" : "stone", rx, ry, rz, { tint: mixTint(0.85 + s.rand() * 0.2) });
  }

  for (const [tx, tz, radius] of TREES) {
    s.tree(tx, tz, groundHeight(tx, tz), { radius, height: radius >= 3 ? 6 + Math.floor(s.rand() * 2) : 5 });
  }

  const bushes: Array<[number, number]> = [
    [-7, -9],
    [-6, -9],
    [9, -6],
    [-4, -12],
    [7, -13],
    [9, -6],
    [-11, 1],
  ];
  for (const [bx, bz] of bushes) {
    s.block(s.rand() < 0.5 ? "leaves" : "leaves_light", bx, groundHeight(bx, bz), bz);
    s.walkable(bx, bz, false);
  }

  // A fallen log on the left, lying along X, with mushrooms at its foot.
  for (let lx = -7; lx <= -4; lx++) {
    s.block("log", lx, 0, -6);
    s.walkable(lx, -6, false);
  }
  s.mushroom(-3.6, -5.7, "mushroom_red");
  s.mushroom(-7.3, -4.8, "mushroom_brown");
  s.walkable(-4, -6, false);
  s.walkable(-8, -5, false);
  for (const [mx, mz, cap] of [
    [-9.4, -12.3, "mushroom_red"],
    [-12.3, -5.3, "mushroom_brown"],
    [-12.7, -4.6, "mushroom_red"],
    [9.6, -13.4, "mushroom_brown"],
    [12.6, -6.4, "mushroom_red"],
  ] as const) {
    s.mushroom(mx, mz, cap, groundHeight(Math.floor(mx), Math.floor(mz)));
  }

  // The portrait camera sees a narrow wedge along -Z from the play spot, so
  // every spot stays within roughly a fifth of its distance from that line.
  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -3.5, facing: Math.PI / 2 },
    forage_2: { x: -2.5, z: -8.5, facing: -Math.PI / 2 + 0.6 },
    sleep_1: { x: -3.5, z: -3.5, facing: Math.PI + 0.5 },
    swim_1: { x: 3.5, z: -9.5, facing: Math.PI + 0.3, medium: "water" },
    air_1: { x: 0.5, z: -7.5, y: 3, facing: Math.PI, medium: "air" },
    ambient_1: { x: -5.5, z: -2.5, facing: Math.PI / 2 },
    ambient_2: { x: 4.5, z: -5.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  // Flowers thicken toward the front and the centre line the portrait
  // camera looks down, white and pink with a few yellow.
  s.forEachCell((x, z) => {
    if (!s.isWalkable(x, z) || s.isReserved(x, z) || s.inFront(x, z)) return;
    const front = z > -3;
    const centre = Math.abs(x - SUBJECT.x) < 4 && !front;
    const chance = (front ? 0.1 : z > -9 ? 0.08 : 0.04) * (centre ? 2 : 1);
    if (s.rand() >= chance) return;
    const r = s.rand();
    const kind = r < 0.5 ? "flower_white" : r < 0.82 ? "flower_pink" : "flower_yellow";
    s.flower(x + 0.25 + s.rand() * 0.5, z + 0.25 + s.rand() * 0.5, kind);
    s.walkable(x, z, false);
  });

  return s.finish({
    id: "meadow",
    spots,
    spawn: spots.play_1,
    lights: { sun: 1, hemi: 1, fogNear: 22, fogFar: 64 },
    backdrop: { style: "trees", sky: 0x8fd0ff, horizon: 0xcfe8d8, silhouette: 0x3f8f3c, z: -25, height: 16 },
    framing: { subject: SUBJECT },
    particles: "none",
  });
}

export const meadow = once(buildMeadow);
