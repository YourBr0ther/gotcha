import { describe, expect, it } from "vitest";
import { mulberry32 } from "../dioramas/build";
import type { AirVolume } from "../dioramas/types";
import { createNavGrid, setWalkable } from "../nav/grid";
import { between, buddyStage, cellsWhere, inFrame, nextWanderTarget, onStage, planFlight, planGround, reachable, rimCells, TIMING } from "./wander";

/** A 16x16 grid from (-8,-14) with the whole floor walkable except a 2x2 rock, and a far island nothing reaches. */
function grid() {
  const g = createNavGrid(-8, -14, 16, 16);
  for (let cz = 1; cz < 15; cz++) for (let cx = 1; cx < 15; cx++) setWalkable(g, cx, cz, true);
  setWalkable(g, 7, 7, false);
  setWalkable(g, 8, 7, false);
  setWalkable(g, 7, 8, false);
  setWalkable(g, 8, 8, false);
  // Cut a moat around the island at the far corner.
  for (let cx = 1; cx < 15; cx++) setWalkable(g, cx, 3, false);
  for (let cz = 1; cz < 4; cz++) setWalkable(g, 11, cz, false);
  return g;
}

const def = { framing: { subject: { x: 0.5, z: 1.5 } }, spots: { forage_1: { x: 2.5, z: -3.5 }, play_1: { x: 0.5, z: 1.5 }, ambient_1: { x: -5.5, z: -2.5 } } };

describe("grid helpers", () => {
  it("lists walkable cells and the rim around holes and edges", () => {
    const g = grid();
    const all = cellsWhere(g);
    expect(all.length).toBeGreaterThan(150);
    const rim = rimCells(g);
    expect(rim.length).toBeGreaterThan(40);
    expect(rim.length).toBeLessThan(all.length);
    // Next to the rock is rim; the open middle is not.
    expect(rim.some((p) => p.x === -1.5 && p.z === -6.5)).toBe(true);
    expect(rim.some((p) => p.x === 3.5 && p.z === -8.5)).toBe(false);
  });

  it("only returns cells a path reaches", () => {
    const g = grid();
    const rand = mulberry32(1);
    const island = cellsWhere(g, (x, z) => z < -10 && x > 3.5);
    expect(island.length).toBeGreaterThan(0);
    expect(reachable(g, { x: 0.5, z: -5.5 }, island, rand, 20)).toBeNull();
    const main = cellsWhere(g, (_x, z) => z > -9);
    expect(reachable(g, { x: 0.5, z: -5.5 }, main, rand)).not.toBeNull();
  });
});

describe("planGround", () => {
  it("enters and leaves on the visible flanks, away from the subject and never on the island, and haunts only spots on stage", () => {
    const g = grid();
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planGround(def, g, mulberry32(seed))!;
      expect(plan).not.toBeNull();
      const keep = onStage(def.framing.subject);
      expect(keep(plan.entry.x, plan.entry.z)).toBe(true);
      expect(keep(plan.exit.x, plan.exit.z)).toBe(true);
      expect(plan.entry.z).toBeGreaterThan(-10.5);
      expect(Math.hypot(plan.entry.x - 0.5, plan.entry.z - 1.5)).toBeGreaterThanOrEqual(5);
      expect(plan.haunts.map((h) => h.x)).toEqual([2.5]);
    }
  });

  it("keeps the stage off the strip the subject hides and inside the frame", () => {
    const keep = onStage({ x: 0.5, z: 1.5 });
    expect(keep(0.5, -8.5)).toBe(false);
    expect(keep(2.5, -8.5)).toBe(true);
    expect(keep(-2.5, -8.5)).toBe(true);
    expect(keep(5.5, -8.5)).toBe(false);
    expect(keep(2.5, 0.5)).toBe(false);
    const frame = inFrame({ x: 0.5, z: 1.5 });
    expect(frame(0.5, -8.5)).toBe(true);
    expect(frame(5.5, -8.5)).toBe(false);
  });

  it("varies the entry between seeds", () => {
    const g = grid();
    const entries = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const plan = planGround(def, g, mulberry32(seed))!;
      entries.add(`${plan.entry.x},${plan.entry.z}`);
    }
    expect(entries.size).toBeGreaterThan(3);
  });

  it("wanders to reachable cells behind the subject and sometimes to a haunt", () => {
    const g = grid();
    const rand = mulberry32(3);
    const plan = planGround(def, g, rand)!;
    let haunted = 0;
    for (let i = 0; i < 30; i++) {
      const t = nextWanderTarget(plan, g, plan.entry, rand)!;
      expect(t).not.toBeNull();
      expect(plan.keep(t.x, t.z)).toBe(true);
      if (plan.haunts.includes(t)) haunted++;
    }
    expect(haunted).toBeGreaterThan(0);
    expect(haunted).toBeLessThan(30);
  });

  it("keeps wander targets within ten blocks of the subject while the stage has room there", () => {
    const g = grid();
    const rand = mulberry32(5);
    const plan = planGround(def, g, rand)!;
    for (let i = 0; i < 30; i++) {
      const t = nextWanderTarget(plan, g, plan.entry, rand)!;
      expect(t.z).toBeGreaterThanOrEqual(1.5 - 10);
    }
  });

  it("gives up on a grid with nothing behind the subject", () => {
    const g = createNavGrid(-8, -14, 16, 16);
    expect(planGround(def, g, mulberry32(1))).toBeNull();
  });
});

describe("planFlight", () => {
  const air: AirVolume = { x: -6, z: -14, w: 12, d: 14, yMin: 2, yMax: 5 };
  const framing = { subject: { x: 0.5, z: 1.5 } };
  const inside = (p: { x: number; z: number; y?: number }) => p.x >= air.x && p.x <= air.x + air.w && p.z >= air.z && p.z <= air.z + air.d;
  const framed = inFrame(framing.subject);

  it("starts outside the volume, ends outside on another side, and keeps every height within the volume", () => {
    let orbits = 0;
    let passes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const plan = planFlight({ air: [air], framing }, mulberry32(seed))!;
      expect(inside(plan.entry)).toBe(false);
      expect(inside(plan.exit)).toBe(false);
      expect(plan.entry.y!).toBeGreaterThanOrEqual(air.yMin);
      expect(plan.entry.y!).toBeLessThanOrEqual(air.yMax);
      const sideOf = (p: { x: number; z: number }) => (p.x < air.x ? "left" : p.x > air.x + air.w ? "right" : "back");
      expect(sideOf(plan.entry)).not.toBe(sideOf(plan.exit));
      if (plan.kind === "orbit") {
        orbits++;
        expect(inside(plan.approach)).toBe(true);
        for (const o of plan.orbits) {
          expect(o.y).toBeGreaterThanOrEqual(air.yMin);
          expect(o.y).toBeLessThanOrEqual(air.yMax);
          expect(inside({ x: o.x - o.radius, z: o.z })).toBe(true);
          expect(inside({ x: o.x + o.radius, z: o.z + o.radius })).toBe(true);
          expect(framed(o.x, o.z)).toBe(true);
        }
      } else {
        passes++;
        expect(plan.waypoints.length).toBeGreaterThan(0);
        expect(plan.waypoints.every(inside)).toBe(true);
        expect(plan.waypoints.every((w) => framed(w.x, w.z))).toBe(true);
      }
    }
    expect(orbits).toBeGreaterThan(0);
    expect(passes).toBeGreaterThan(0);
  });

  it("is null for a scene with no air volume", () => {
    expect(planFlight({ air: [], framing }, mulberry32(1))).toBeNull();
  });
});

describe("timing", () => {
  it("draws from the range", () => {
    const rand = mulberry32(9);
    for (let i = 0; i < 20; i++) {
      const gap = between(TIMING.gap, rand);
      expect(gap).toBeGreaterThanOrEqual(TIMING.gap[0]);
      expect(gap).toBeLessThanOrEqual(TIMING.gap[1]);
    }
    expect(TIMING.gap[0]).toBeGreaterThan(TIMING.stay[0]);
  });
});

describe("buddyStage", () => {
  it("is the frame's wedge from just behind the subject to a few blocks back, centre included", () => {
    const keep = buddyStage({ x: 0.5, z: 1.5 });
    expect(keep(0.5, 1.5)).toBe(false); // on the spot itself
    expect(keep(0.5, -1)).toBe(true); // straight back, centre strip allowed
    expect(keep(2.5, -3.5)).toBe(true); // a forage spot
    expect(keep(0.5, -8)).toBe(false); // too far to read on a phone
    expect(keep(6, -1)).toBe(false); // outside the wedge
  });
});
