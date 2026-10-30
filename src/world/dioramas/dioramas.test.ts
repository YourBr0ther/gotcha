import { describe, expect, it } from "vitest";
import { findPath, isWalkable, worldToCell } from "../nav/grid";
import { DIORAMA_IDS, getDiorama } from "./index";
import { meadow } from "./meadow";

const REQUIRED = ["forage_1", "forage_2", "play_1", "sleep_1"];

describe.each(DIORAMA_IDS)("%s diorama", (id) => {
  const d = getDiorama(id);

  it("is built once and has the required spots", () => {
    expect(getDiorama(id)).toBe(d);
    expect(d.id).toBe(id);
    expect(d.blocks.length).toBeGreaterThan(500);
    for (const name of REQUIRED) expect(d.spots[name], name).toBeDefined();
    expect(d.spots.ambient_1).toBeDefined();
    expect(d.spots.ambient_2).toBeDefined();
    expect(d.spawn).toBe(d.spots.play_1);
  });

  it("puts land spots on walkable cells that reach each other", () => {
    const land = Object.entries(d.spots).filter(([, s]) => (s.medium ?? "land") === "land");
    const cells = land.map(([name, s]) => ({ name, cell: worldToCell(d.nav, s.x, s.z) }));
    for (const { name, cell } of cells) expect(isWalkable(d.nav, cell.cx, cell.cz), name).toBe(true);
    for (let i = 1; i < cells.length; i++) expect(findPath(d.nav, cells[0].cell, cells[i].cell), cells[i].name).not.toBeNull();
  });

  it("puts water spots in the swim grid, air spots in an air volume, and keeps water off the land grid", () => {
    for (const [name, s] of Object.entries(d.spots)) {
      if (s.medium === "water") {
        const c = worldToCell(d.swimNav, s.x, s.z);
        expect(isWalkable(d.swimNav, c.cx, c.cz), name).toBe(true);
        expect(isWalkable(d.nav, c.cx, c.cz), name).toBe(false);
      }
      if (s.medium === "air") {
        expect(s.y, name).toBeGreaterThan(0);
        const inside = d.air.some((a) => s.x >= a.x && s.x <= a.x + a.w && s.z >= a.z && s.z <= a.z + a.d && s.y! >= a.yMin && s.y! <= a.yMax);
        expect(inside, name).toBe(true);
      }
    }
    for (const w of d.water) {
      const c = worldToCell(d.nav, w.x + w.w / 2, w.z + w.d / 2);
      expect(isWalkable(d.nav, c.cx, c.cz)).toBe(false);
      expect(isWalkable(d.swimNav, c.cx, c.cz)).toBe(true);
    }
    expect(d.air.length).toBeGreaterThan(0);
    expect(d.spots.air_1.medium).toBe("air");
  });

  it("carries a light rig, a backdrop and framing", () => {
    expect(d.lights.fogFar).toBeGreaterThan(d.lights.fogNear);
    expect(d.backdrop.z).toBeLessThan(-20);
    expect(d.framing.subject).toEqual({ x: 0.5, z: 1.5 });
  });
});

describe("meadow", () => {
  it("keeps the pond and trees off the navmesh", () => {
    const d = meadow();
    const pond = worldToCell(d.nav, 5.5, -6.5);
    expect(isWalkable(d.nav, pond.cx, pond.cz)).toBe(false);
    const trunk = worldToCell(d.nav, -12.5, -2.5);
    expect(isWalkable(d.nav, trunk.cx, trunk.cz)).toBe(false);
    expect(d.water).toHaveLength(1);
  });
});

describe("water dioramas", () => {
  it.each(["beach", "pond", "cave", "meadow"] as const)("%s has swim spots", (id) => {
    expect(getDiorama(id).spots.swim_1?.medium).toBe("water");
  });
  it("cave has crystal lights and a fixed dark sky", () => {
    const d = getDiorama("cave");
    expect(d.lights.points?.length).toBeGreaterThan(2);
    expect(d.lights.sky).toBeDefined();
    expect(d.blocks.some((b) => b.block === "crystal_cyan")).toBe(true);
  });
  it("snowfield snows", () => {
    expect(getDiorama("snowfield").particles).toBe("snow");
  });
});
