/**
 * The beach: sand in front, a shallow sea filling the back, palms on a low
 * dune to the left and a grassy corner to the right, shells underfoot.
 */

import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, Spot } from "./types";

const SEA_Z = -9;

function groundHeight(x: number, z: number): number {
  if (x <= -10 && z > -7 && z < 5) return 1;
  return 0;
}

function isGrass(x: number, z: number): boolean {
  return x >= 9 && z >= -4;
}

export function buildBeach(): DioramaDef {
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261102);

  s.forEachCell((x, z) => {
    if (z < SEA_Z) {
      s.block("sand_wet", x, -2, z, { tint: mixTint(0.92 + s.rand() * 0.1) });
      return;
    }
    const h = groundHeight(x, z);
    const top = isGrass(x, z) ? "grass" : z < SEA_Z + 2 ? "sand_wet" : "sand";
    s.column(top, "sand", x, z, h, groundHeight, mixTint(0.94 + s.rand() * 0.08));
    if (h === 0) s.walkable(x, z, true);
  });

  s.addWater({ x: DEFAULT_BOUNDS.minX, z: DEFAULT_BOUNDS.minZ, w: 28, d: SEA_Z - DEFAULT_BOUNDS.minZ, y: -0.25, depth: 0.7 });
  s.addAir({ x: -6, z: -16, w: 13, d: 16, yMin: 0.9, yMax: 5 });

  const palms: Array<[number, number]> = [
    [-3, -6],
    [4, -8],
    [-12, -3],
    [11, -2],
    [-5, 3],
  ];
  for (const [px, pz] of palms) {
    s.tree(px, pz, groundHeight(px, pz), { trunk: "log_palm", shape: "palm", height: 5 + Math.floor(s.rand() * 2) });
  }

  const rocks: Array<[number, number, number]> = [
    [-8, -7, 0],
    [-9, -7, 0],
    [-9, -7, 1],
    [7, -8, 0],
    [8, -8, 0],
    [12, -8, 0],
  ];
  for (const [rx, rz, ry] of rocks) {
    s.block("stone", rx, ry, rz, { tint: 0xd0d0d0 + Math.floor(s.rand() * 0x2f2f2f) });
    s.walkable(rx, rz, false);
  }

  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -3.5, facing: Math.PI / 2 },
    forage_2: { x: -2.5, z: -6.5, facing: -Math.PI / 2 + 0.5 },
    sleep_1: { x: -3.5, z: -0.5, facing: Math.PI + 0.6 },
    swim_1: { x: 0.5, z: -12.5, facing: Math.PI, medium: "water" },
    swim_2: { x: -3.5, z: -15.5, facing: Math.PI / 2, medium: "water" },
    air_1: { x: 0.5, z: -8, y: 3, facing: Math.PI, medium: "air" },
    ambient_1: { x: 5.5, z: -5.5, facing: Math.PI / 2 },
    ambient_2: { x: -6.5, z: -3.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  s.scatter(0.12, (x, z) => {
    if (isGrass(x, z)) {
      s.block("tuft", x + 0.2 + s.rand() * 0.6, 0, z + 0.2 + s.rand() * 0.6);
      return false;
    }
    if (s.rand() < 0.5) return false;
    s.block("shell", x + 0.2 + s.rand() * 0.6, 0, z + 0.2 + s.rand() * 0.6, { rotationY: s.rand() * Math.PI });
    return false;
  });

  return s.finish({
    id: "beach",
    spots,
    spawn: spots.play_1,
    lights: { sun: 1.1, hemi: 1.05, fogNear: 24, fogFar: 70 },
    backdrop: { style: "palms", sky: 0x6fc3ff, horizon: 0xbfe8ff, silhouette: 0x2e7fb8, z: -24, height: 14 },
    framing: { subject: SUBJECT },
    particles: "none",
  });
}

export const beach = once(buildBeach);
