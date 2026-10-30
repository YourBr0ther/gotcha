import { describe, expect, it } from "vitest";
import type { Spot } from "../dioramas/types";
import { readLocomotion, resolveSpot } from "./locomotion";

const spots: Record<string, Spot> = {
  play_1: { x: 0.5, z: 1.5 },
  forage_1: { x: 2.5, z: -3.5 },
  sleep_1: { x: 3.5, z: -10.5 },
  swim_1: { x: 5.5, z: -6.5, medium: "water" },
  swim_2: { x: -3.5, z: -15.5, medium: "water" },
  air_1: { x: 0.5, z: -7.5, y: 3, medium: "air" },
};

describe("readLocomotion", () => {
  it("defaults to a walker that can swim, like Cobblemon", () => {
    expect(readLocomotion(undefined)).toEqual({ walks: true, swims: true, flies: false, waterOnly: false, prefersWater: false });
  });

  it("reads Eevee as a walker that avoids water", () => {
    const loco = readLocomotion({ moving: { swim: { avoidsWater: true } } });
    expect(loco.walks).toBe(true);
    expect(loco.swims).toBe(false);
  });

  it("reads Magikarp as water-only", () => {
    const loco = readLocomotion({ moving: { swim: { canBreatheUnderwater: true }, walk: { avoidsLand: true } } });
    expect(loco).toMatchObject({ walks: false, swims: true, waterOnly: true, prefersWater: true });
  });

  it("reads Zubat as a flier that cannot walk", () => {
    const loco = readLocomotion({ moving: { fly: { canFly: true }, swim: { avoidsWater: true }, walk: { canWalk: false } } });
    expect(loco).toMatchObject({ flies: true, walks: false, swims: false, waterOnly: false });
  });

  it("reads Psyduck as a walker that also swims", () => {
    const loco = readLocomotion({ moving: { swim: { canBreatheUnderwater: true } } });
    expect(loco).toMatchObject({ walks: true, swims: true, prefersWater: false });
  });
});

describe("resolveSpot", () => {
  const magikarp = readLocomotion({ moving: { swim: {}, walk: { avoidsLand: true } } });
  const eevee = readLocomotion({ moving: { swim: { avoidsWater: true } } });
  const zubat = readLocomotion({ moving: { fly: { canFly: true }, walk: { canWalk: false } } });
  const psyduck = readLocomotion({ moving: { swim: {} } });

  it("sends a water-only species to the nearest water spot", () => {
    expect(resolveSpot(spots, "forage_1", magikarp)).toBe("swim_1");
    expect(resolveSpot(spots, "sleep_1", magikarp)).toBe("swim_1");
    expect(resolveSpot(spots, "swim_2", magikarp)).toBe("swim_2");
  });

  it("keeps a walker off water and air spots", () => {
    expect(resolveSpot(spots, "swim_1", eevee)).toBe("forage_1");
    expect(resolveSpot(spots, "air_1", eevee)).toBe("sleep_1");
    expect(resolveSpot(spots, "sleep_1", eevee)).toBe("sleep_1");
  });

  it("lets a flier go anywhere and an amphibian swim", () => {
    expect(resolveSpot(spots, "air_1", zubat)).toBe("air_1");
    expect(resolveSpot(spots, "swim_2", zubat)).toBe("swim_2");
    expect(resolveSpot(spots, "swim_1", psyduck)).toBe("swim_1");
    expect(resolveSpot(spots, "forage_1", psyduck)).toBe("forage_1");
  });

  it("returns undefined for an unknown name and falls back to land when there is no water", () => {
    expect(resolveSpot(spots, "nowhere", eevee)).toBeUndefined();
    const dry: Record<string, Spot> = { play_1: spots.play_1, forage_1: spots.forage_1 };
    expect(resolveSpot(dry, "forage_1", magikarp)).toBe("forage_1");
  });
});
