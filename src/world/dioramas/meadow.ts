/**
 * The meadow: a flat lawn in front, a pond on the right, a fallen log on
 * the left, stepped ground and a wall of trees at the back.
 */

import type { BlockId } from "../blocks/palette";
import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, Spot } from "./types";

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
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261030);

  s.forEachCell((x, z) => {
    const h = groundHeight(x, z);
    if (inPond(x, z)) {
      s.block("sand", x, -2, z);
      return;
    }
    s.column("grass", "dirt", x, z, h, groundHeight, mixTint(0.94 + s.rand() * 0.1));
    if (h === 0) s.walkable(x, z, true);
  });

  s.addWater({ x: POND.x, z: POND.z, w: POND.w, d: POND.d, y: -0.2, depth: 0.7 });
  s.addAir({ x: -6, z: -14, w: 12, d: 16, yMin: 0.9, yMax: 4.5 });

  for (const [tx, tz] of TREES) s.tree(tx, tz, groundHeight(tx, tz));

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
    s.block(s.rand() < 0.5 ? "leaves" : "leaves_light", bx, groundHeight(bx, bz), bz);
    s.walkable(bx, bz, false);
  }

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
    s.block("stone", rx, groundHeight(rx, rz) + ry, rz, { tint: 0xdcdcdc + Math.floor(s.rand() * 0x202020) });
    s.walkable(rx, rz, false);
  }

  // A fallen log on the left, lying along X.
  for (let lx = -9; lx <= -6; lx++) {
    s.block("log", lx, 0, -1);
    s.walkable(lx, -1, false);
  }

  // The portrait camera sees a narrow wedge along -Z from the play spot, so
  // every spot stays within roughly a fifth of its distance from that line.
  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -3.5, facing: Math.PI / 2 },
    forage_2: { x: -1.5, z: -8.5, facing: -Math.PI / 2 + 0.6 },
    sleep_1: { x: 3.5, z: -10.5, facing: Math.PI + 0.5 },
    swim_1: { x: 5.5, z: -6.5, facing: Math.PI + 0.3, medium: "water" },
    air_1: { x: 0.5, z: -7.5, y: 3, facing: Math.PI, medium: "air" },
    ambient_1: { x: -5.5, z: -5.5, facing: Math.PI / 2 },
    ambient_2: { x: -3.5, z: -10.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  const flowerKinds: BlockId[] = ["flower_white", "flower_pink", "flower_yellow"];
  s.forEachCell((x, z) => {
    if (!s.isWalkable(x, z) || s.isReserved(x, z)) return;
    const r = s.rand();
    if (r < 0.06) {
      const kind = flowerKinds[Math.floor(s.rand() * flowerKinds.length)];
      const ox = x + 0.3 + s.rand() * 0.4;
      const oz = z + 0.3 + s.rand() * 0.4;
      s.block("stem", ox, 0, oz);
      s.block(kind, ox, 0.42, oz);
      s.walkable(x, z, false);
    } else if (r < 0.2) {
      s.block("tuft", x + 0.2 + s.rand() * 0.6, 0, z + 0.2 + s.rand() * 0.6, { tint: mixTint(0.9 + s.rand() * 0.2) });
    }
  });

  return s.finish({
    id: "meadow",
    spots,
    spawn: spots.play_1,
    lights: { sun: 1, hemi: 1, fogNear: 14, fogFar: 36 },
    backdrop: { style: "trees", sky: 0x8fd0ff, horizon: 0xd8ecff, silhouette: 0x3f7a35, z: -24, height: 14 },
    framing: { subject: SUBJECT },
    particles: "none",
  });
}

export const meadow = once(buildMeadow);
