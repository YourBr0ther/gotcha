/**
 * The pond: a grassy bank in front, water filling the middle with lily pads
 * and reeds at the edge, a raised far bank with trees.
 */

import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, Spot } from "./types";

const WATER = { x: -11, z: -19, w: 22, d: 14 };

function inWater(x: number, z: number): boolean {
  return x >= WATER.x && x < WATER.x + WATER.w && z >= WATER.z && z < WATER.z + WATER.d;
}

function groundHeight(x: number, z: number): number {
  if (z <= -20) return 2;
  if (z <= -19) return 1;
  if (x <= -13 || x >= 13) return 1;
  return 0;
}

export function buildPond(): DioramaDef {
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261105);

  s.forEachCell((x, z) => {
    if (inWater(x, z)) {
      s.block("dirt", x, -2, z, { tint: mixTint(0.7 + s.rand() * 0.1) });
      return;
    }
    const h = groundHeight(x, z);
    s.column("grass", "dirt", x, z, h, groundHeight, mixTint(0.92 + s.rand() * 0.1));
    if (h === 0) s.walkable(x, z, true);
  });

  s.addWater({ x: WATER.x, z: WATER.z, w: WATER.w, d: WATER.d, y: -0.2, depth: 1 });
  s.addAir({ x: -8, z: -17, w: 17, d: 16, yMin: 0.9, yMax: 4.5 });

  const trees: Array<[number, number]> = [
    [-10, -21],
    [-4, -22],
    [2, -21],
    [8, -22],
    [13, -20],
    [-13, -12],
    [13, -8],
    [12, -14],
  ];
  for (const [tx, tz] of trees) s.tree(tx, tz, groundHeight(tx, tz), { leaves: ["leaves", "leaves_light"] });

  // Lily pads drift on the water; reeds line the edge on both sides.
  for (let i = 0; i < 26; i++) {
    const x = WATER.x + Math.floor(s.rand() * WATER.w);
    const z = WATER.z + 2 + Math.floor(s.rand() * (WATER.d - 3));
    s.block("lily_pad", x + 0.5, -0.19, z + 0.5, { rotationY: s.rand() * Math.PI, tint: mixTint(0.85 + s.rand() * 0.25) });
  }
  for (let x = WATER.x; x < WATER.x + WATER.w; x++) {
    if (s.rand() < 0.45) s.block("reed", x + 0.2 + s.rand() * 0.6, -0.6, WATER.z + WATER.d - 1 + 0.2 + s.rand() * 0.6);
    if (s.rand() < 0.35) s.block("reed", x + 0.2 + s.rand() * 0.6, -0.6, WATER.z + 0.2 + s.rand() * 0.6);
  }
  for (let z = WATER.z; z < WATER.z + WATER.d; z++) {
    if (s.rand() < 0.4) s.block("reed", WATER.x + 0.3 + s.rand() * 0.4, -0.6, z + 0.2 + s.rand() * 0.6);
    if (s.rand() < 0.4) s.block("reed", WATER.x + WATER.w - 1 + 0.3 + s.rand() * 0.4, -0.6, z + 0.2 + s.rand() * 0.6);
  }

  const rocks: Array<[number, number]> = [
    [-8, -3],
    [9, -4],
    [-12, 3],
  ];
  for (const [rx, rz] of rocks) {
    s.block("stone", rx, groundHeight(rx, rz), rz, { tint: 0xd8d8d8 });
    s.walkable(rx, rz, false);
  }

  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -3.5, facing: Math.PI / 2 + 0.3 },
    forage_2: { x: -2.5, z: -4.5, facing: -Math.PI / 2 + 0.3 },
    sleep_1: { x: -3.5, z: -0.5, facing: Math.PI + 0.6 },
    swim_1: { x: 0.5, z: -9.5, facing: Math.PI, medium: "water" },
    swim_2: { x: 3.5, z: -13.5, facing: Math.PI / 2, medium: "water" },
    swim_3: { x: -3.5, z: -12.5, facing: -Math.PI / 2, medium: "water" },
    air_1: { x: 0.5, z: -9, y: 3, facing: Math.PI, medium: "air" },
    ambient_1: { x: 5.5, z: -2.5, facing: Math.PI / 2 },
    ambient_2: { x: -6.5, z: -3.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  s.scatter(0.18, (x, z) => {
    const r = s.rand();
    if (r < 0.25) {
      const ox = x + 0.3 + s.rand() * 0.4;
      const oz = z + 0.3 + s.rand() * 0.4;
      s.block("stem", ox, 0, oz);
      s.block(s.rand() < 0.5 ? "flower_white" : "flower_yellow", ox, 0.42, oz);
      return true;
    }
    s.block("tuft", x + 0.2 + s.rand() * 0.6, 0, z + 0.2 + s.rand() * 0.6, { tint: mixTint(0.9 + s.rand() * 0.2) });
    return false;
  });

  return s.finish({
    id: "pond",
    spots,
    spawn: spots.play_1,
    lights: { sun: 1, hemi: 1, fogNear: 12, fogFar: 34 },
    backdrop: { style: "reeds", sky: 0x8fd0ff, horizon: 0xd0ecd0, silhouette: 0x3d7a3a, z: -24, height: 14 },
    framing: { subject: SUBJECT },
    particles: "none",
  });
}

export const pond = once(buildPond);
