/**
 * The snowfield: snow over stepped ground, spruces, an ice patch, falling
 * snow.
 */

import { DEFAULT_BOUNDS, mixTint, once, SceneBuilder, SUBJECT } from "./build";
import type { DioramaDef, Spot } from "./types";

const ICE = { x: -1, z: -9, w: 5, d: 3 };

function groundHeight(x: number, z: number): number {
  let h = 0;
  if (z <= -12) h = 1;
  if (z <= -16) h = 2;
  if (z <= -19) h = 3;
  if (x <= -11 && z <= -3 && z > -12) h = 1;
  if (x >= 11 && z <= -5 && z > -12) h = 1;
  return h;
}

function inIce(x: number, z: number): boolean {
  return x >= ICE.x && x < ICE.x + ICE.w && z >= ICE.z && z < ICE.z + ICE.d;
}

export function buildSnowfield(): DioramaDef {
  const s = new SceneBuilder(DEFAULT_BOUNDS, 20261104);

  s.forEachCell((x, z) => {
    const h = groundHeight(x, z);
    s.column(inIce(x, z) ? "ice" : "snow", "dirt", x, z, h, groundHeight, mixTint(0.95 + s.rand() * 0.05));
    if (h === 0) s.walkable(x, z, true);
  });

  s.addAir({ x: -6, z: -14, w: 13, d: 15, yMin: 0.9, yMax: 4.5 });

  const spruces: Array<[number, number]> = [
    [-11, -20],
    [-6, -21],
    [0, -20],
    [5, -21],
    [10, -20],
    [13, -17],
    [-13, -10],
    [-13, -4],
    [12, -8],
    [12, -1],
    [-8, -14],
    [7, -14],
    [-4, -15],
    [4, -17],
  ];
  for (const [tx, tz] of spruces) {
    s.tree(tx, tz, groundHeight(tx, tz), { trunk: "log_dark", leaves: ["leaves_spruce"], shape: "cone", height: 6 + Math.floor(s.rand() * 3), radius: 2 });
  }

  const rocks: Array<[number, number]> = [
    [7, -10],
    [8, -10],
    [-7, -8],
    [-9, 1],
  ];
  for (const [rx, rz] of rocks) {
    const h = groundHeight(rx, rz);
    s.block("stone", rx, h, rz, { tint: 0xc8ccd4 });
    s.block("snow_tuft", rx + 0.5, h + 1, rz + 0.5);
    s.walkable(rx, rz, false);
  }

  const spots: Record<string, Spot> = {
    play_1: { x: 0.5, z: 1.5, facing: Math.PI - 0.4 },
    forage_1: { x: 2.5, z: -3.5, facing: Math.PI / 2 },
    forage_2: { x: 1.5, z: -7.5, facing: -Math.PI / 2 + 0.6 },
    sleep_1: { x: -3.5, z: -10.5, facing: Math.PI + 0.5 },
    air_1: { x: 0.5, z: -7, y: 3, facing: Math.PI, medium: "air" },
    ambient_1: { x: 5.5, z: -6.5, facing: Math.PI / 2 },
    ambient_2: { x: -6.5, z: -9.5, facing: -Math.PI / 2 },
  };
  for (const spot of Object.values(spots)) s.reserve(spot);

  s.scatter(0.08, (x, z) => {
    if (inIce(x, z)) return false;
    s.block("snow_tuft", x + 0.2 + s.rand() * 0.6, 0, z + 0.2 + s.rand() * 0.6);
    return false;
  });

  return s.finish({
    id: "snowfield",
    spots,
    spawn: spots.play_1,
    lights: { sun: 0.95, hemi: 1.1, fogNear: 14, fogFar: 44 },
    backdrop: { style: "spruce", sky: 0xbcd4e8, horizon: 0xe8f0f8, silhouette: 0x2b4a3a, z: -24, height: 14 },
    framing: { subject: SUBJECT },
    particles: "snow",
  });
}

export const snowfield = once(buildSnowfield);
