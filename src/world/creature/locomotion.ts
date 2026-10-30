/**
 * How a species gets around, read from Cobblemon's behaviour block with the
 * mod's defaults: a pokemon walks and swims unless told otherwise, and
 * flies only when told so.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { Medium, Spot } from "../dioramas/types";

export interface Locomotion {
  walks: boolean;
  swims: boolean;
  flies: boolean;
  /** Never leaves the water (`avoidsLand`); sent to the nearest water spot. */
  waterOnly: boolean;
  /** Can swim and cannot walk, or avoids land: water spots win over land ones. */
  prefersWater: boolean;
}

export function readLocomotion(behaviour?: SpeciesBehaviour): Locomotion {
  const moving = behaviour?.moving ?? {};
  const walk = moving.walk ?? {};
  const swim = moving.swim ?? {};
  const flies = moving.fly?.canFly === true;
  const swims = swim.canSwimInWater !== false && swim.avoidsWater !== true;
  const walks = walk.canWalk !== false && walk.avoidsLand !== true;
  const waterOnly = swims && walk.avoidsLand === true && !flies;
  const prefersWater = swims && !flies && (walk.canWalk === false || walk.avoidsLand === true);
  return { walks: walks || (!swims && !flies), swims, flies, waterOnly, prefersWater };
}

export function spotMedium(spot: Spot): Medium {
  return spot.medium ?? "land";
}

function nearest(spots: Record<string, Spot>, medium: Medium, x: number, z: number): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [name, spot] of Object.entries(spots)) {
    if (spotMedium(spot) !== medium) continue;
    const d = (spot.x - x) ** 2 + (spot.z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

/**
 * The spot a creature is actually sent to when asked for `name`. Water-only
 * species go to the nearest water spot; a creature that cannot swim or fly
 * is kept off water and air spots. Returns undefined when the name is
 * unknown. Fliers accept every spot, since they hover over it.
 */
export function resolveSpot(spots: Record<string, Spot>, name: string, loco: Locomotion): string | undefined {
  const spot = spots[name];
  if (!spot) return undefined;
  const medium = spotMedium(spot);
  if (loco.flies) return name;
  if (loco.waterOnly && medium !== "water") return nearest(spots, "water", spot.x, spot.z) ?? name;
  if (medium === "water" && !loco.swims) return nearest(spots, "land", spot.x, spot.z) ?? name;
  if (medium === "air") return nearest(spots, loco.prefersWater ? "water" : "land", spot.x, spot.z) ?? name;
  return name;
}
