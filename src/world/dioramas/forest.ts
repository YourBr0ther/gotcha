/**
 * The forest: a clearing ringed by tall trees whose canopies throw dappled
 * light, a mossy fallen log with mushrooms, ferns on the floor.
 */

import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, Spot } from "./types";

function groundHeight(x: number, z: number): number {
  let h = 0;
  if (z <= -13) h = 1;
  if (z <= -18) h = 2;
  if (x <= -11 && z <= -4) h = 1;
  return h;
}

function inClearing(x: number, z: number): boolean {
  return x >= -4 && x <= 5 && z >= -12 && z <= 7;
}

export function buildForest(): DioramaDef {
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261101);

  s.forEachCell((x, z) => {
    const h = groundHeight(x, z);
    const podzol = s.rand() < (inClearing(x, z) ? 0.12 : 0.4);
    s.column(podzol ? "podzol" : "grass", "dirt", x, z, h, groundHeight, mixTint(0.86 + s.rand() * 0.14));
    if (h === 0) s.walkable(x, z, true);
  });

  s.addAir({ x: -4, z: -12, w: 10, d: 12, yMin: 0.9, yMax: 5 });

  // Trees on a jittered grid everywhere but the clearing; taller at the back.
  for (let gz = -21; gz <= 4; gz += 3) {
    for (let gx = -13; gx <= 13; gx += 3) {
      const tx = gx + Math.floor(s.rand() * 3) - 1;
      const tz = gz + Math.floor(s.rand() * 3) - 1;
      if (!s.inBounds(tx, tz) || inClearing(tx, tz)) continue;
      if (s.rand() < 0.2) continue;
      const tall = tz < -12 || s.rand() < 0.4;
      s.tree(tx, tz, groundHeight(tx, tz), {
        trunk: s.rand() < 0.35 ? "log_dark" : "log",
        leaves: ["leaves", "leaves", "leaves_light"],
        height: tall ? 7 + Math.floor(s.rand() * 2) : 5 + Math.floor(s.rand() * 2),
        radius: tall ? 3 : 2,
      });
    }
  }

  // A mossy fallen log at the left edge of the clearing, with mushrooms around it.
  for (let lx = -6; lx <= -3; lx++) {
    s.block("log_dark", lx, 0, -3);
    s.walkable(lx, -3, false);
  }
  s.block("stone_mossy", -7, 0, -4);
  s.walkable(-7, -4, false);
  const mushrooms: Array<[number, number, "mushroom_red" | "mushroom_brown"]> = [
    [-5.4, -2.3, "mushroom_red"],
    [-2.3, -3.6, "mushroom_brown"],
    [-2.7, -2.2, "mushroom_red"],
    [3.6, -9.4, "mushroom_brown"],
    [4.2, -9.7, "mushroom_brown"],
    [-3.5, -10.6, "mushroom_red"],
  ];
  for (const [mx, mz, cap] of mushrooms) {
    s.block("mushroom_stem", mx, 0, mz);
    s.block(cap, mx, 0.4, mz);
    s.walkable(Math.floor(mx), Math.floor(mz), false);
  }

  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -4.5, facing: Math.PI / 2 + 0.4 },
    forage_2: { x: -2.5, z: -8.5, facing: -Math.PI / 2 + 0.4 },
    sleep_1: { x: -1.5, z: -11.5, facing: Math.PI + 0.3 },
    air_1: { x: 0.5, z: -7.5, y: 3.2, facing: Math.PI, medium: "air" },
    ambient_1: { x: 4.5, z: -7.5, facing: Math.PI / 2 },
    ambient_2: { x: -3.5, z: -5.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  s.scatter(0.2, (x, z) => {
    const r = s.rand();
    if (r < 0.55) {
      s.block("fern", x + 0.15 + s.rand() * 0.7, 0, z + 0.15 + s.rand() * 0.7, { tint: mixTint(0.85 + s.rand() * 0.25) });
      return true;
    }
    s.block("tuft", x + 0.2 + s.rand() * 0.6, 0, z + 0.2 + s.rand() * 0.6, { tint: mixTint(0.8 + s.rand() * 0.2) });
    return false;
  });

  return s.finish({
    id: "forest",
    spots,
    spawn: spots.play_1,
    lights: { sun: 0.85, hemi: 0.75, fogNear: 10, fogFar: 28 },
    backdrop: { style: "trees", sky: 0x7fc4ff, horizon: 0xa9d8a8, silhouette: 0x1f4a24, z: -24, height: 16 },
    framing: { subject: SUBJECT },
    particles: "none",
  });
}

export const forest = once(buildForest);
