/**
 * The cave: a stone chamber with dark walls and a partial ceiling at the
 * back, crystal clusters that glow and light their corner, and a still pool.
 */

import type { BlockId } from "../blocks/palette";
import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, PointLightDef, Spot } from "./types";

const WALL_HEIGHT = 7;
const POOL = { x: 2, z: -11, w: 4, d: 3 };

function inPool(x: number, z: number): boolean {
  return x >= POOL.x && x < POOL.x + POOL.w && z >= POOL.z && z < POOL.z + POOL.d;
}

export function buildCave(): DioramaDef {
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261103);
  const rand = s.rand;

  // The chamber narrows toward the back; everything outside it is wall.
  const halfWidth = (z: number) => 9 - Math.max(0, (-z - 8) * 0.25);
  const wobble = new Map<number, number>();
  const edge = (z: number) => {
    let w = wobble.get(z);
    if (w === undefined) {
      w = Math.floor(rand() * 2);
      wobble.set(z, w);
    }
    return halfWidth(z) + w;
  };
  const isChamber = (x: number, z: number) => z > -15 && Math.abs(x - 0.5) < edge(z);
  const floorKind = (): BlockId => {
    const r = rand();
    return r < 0.12 ? "gravel" : r < 0.3 ? "stone_dark" : "stone";
  };

  s.forEachCell((x, z) => {
    if (!isChamber(x, z)) {
      // Only the wall blocks a camera can see: those with a chamber neighbour, two deep.
      const nearChamber = [1, 2].some((d) => isChamber(x + d, z) || isChamber(x - d, z) || isChamber(x, z + d) || isChamber(x, z - d));
      if (!nearChamber) return;
      const top = WALL_HEIGHT - (rand() < 0.3 ? 1 : 0);
      for (let y = -1; y < top; y++) s.block(y === top - 1 && rand() < 0.3 ? "stone" : "stone_dark", x, y, z, { tint: mixTint(0.85 + rand() * 0.2) });
      return;
    }
    if (inPool(x, z)) {
      s.block("stone_dark", x, -2, z);
      return;
    }
    s.block(floorKind(), x, -1, z, { tint: mixTint(0.85 + rand() * 0.2) });
    s.walkable(x, z, true);
    // The back half has a ceiling with stalactites; the front is open to the sky.
    if (z <= -6) {
      s.block("stone_dark", x, WALL_HEIGHT, z);
      if (rand() < 0.12) {
        const len = 1 + Math.floor(rand() * 2);
        for (let y = 1; y <= len; y++) s.block("stone_dark", x, WALL_HEIGHT - y, z);
      }
    }
  });

  s.addWater({ x: POOL.x, z: POOL.z, w: POOL.w, d: POOL.d, y: -0.2, depth: 0.7 });
  s.addAir({ x: -6, z: -13, w: 13, d: 13, yMin: 0.9, yMax: 4.5 });

  // Boulders.
  const rocks: Array<[number, number, number]> = [
    [-3, -10, 0],
    [-4, -10, 0],
    [-4, -10, 1],
    [4, -4, 0],
    [-5, -3, 0],
    [2, -13, 0],
  ];
  for (const [rx, rz, ry] of rocks) {
    s.block(rand() < 0.5 ? "stone" : "stone_dark", rx, ry, rz, { tint: mixTint(0.8 + rand() * 0.3) });
    s.walkable(rx, rz, false);
  }

  // Crystal clusters, each with the light it throws.
  const points: PointLightDef[] = [];
  // The portrait wedge is narrow, so the clusters hug the centre line.
  const clusters: Array<[number, number, number, "cyan" | "violet"]> = [
    [-2, -6, 0, "cyan"],
    [3, -8, 0, "violet"],
    [-3, -13, 0, "cyan"],
    [1, -14, 0, "violet"],
    [-5, -3, 0, "cyan"],
  ];
  for (const [cx, cz, cy, kind] of clusters) {
    const count = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const id: BlockId = kind === "cyan" ? (rand() < 0.8 ? "crystal_cyan" : "crystal_violet") : rand() < 0.8 ? "crystal_violet" : "crystal_cyan";
      s.block(id, cx + 0.2 + rand() * 0.7, cy, cz + 0.2 + rand() * 0.7, { rotationY: rand() * Math.PI });
    }
    s.walkable(cx, cz, false);
    points.push({ x: cx + 0.5, y: cy + 1.1, z: cz + 0.5, color: kind === "cyan" ? 0x6fe8ff : 0xc77dff, intensity: 30, distance: 11 });
  }
  // A few crystals growing out of the walls.
  for (const [wx, wy, wz] of [
    [-4, 2, -14],
    [3, 3, -14],
    [0, 5, -14],
  ] as const) {
    s.block(rand() < 0.5 ? "crystal_cyan" : "crystal_violet", wx + 0.3, wy, wz + 0.3);
  }

  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: -2.5, z: -3.5, facing: -Math.PI / 2 },
    forage_2: { x: -0.5, z: -8.5, facing: Math.PI / 2 + 0.5 },
    sleep_1: { x: -1.5, z: -11.5, facing: Math.PI + 0.4 },
    swim_1: { x: 3.5, z: -9.5, facing: Math.PI + 0.3, medium: "water" },
    air_1: { x: 0.5, z: -6, y: 2.8, facing: Math.PI, medium: "air" },
    ambient_1: { x: -5.5, z: -5.5, facing: Math.PI / 2 },
    ambient_2: { x: -4.5, z: -12.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  return s.finish({
    id: "cave",
    spots,
    spawn: spots.play_1,
    lights: { sun: 0.45, hemi: 0.9, fogNear: 9, fogFar: 30, sky: 0x06070d, fog: 0x0b0e1a, points },
    backdrop: { style: "rock", sky: 0x0b0d16, horizon: 0x14182a, silhouette: 0x0a0c14, z: -24, height: 12 },
    framing: { subject: SUBJECT },
    particles: "none",
  });
}

export const cave = once(buildCave);
