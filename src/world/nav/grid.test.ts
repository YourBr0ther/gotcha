import { describe, expect, it } from "vitest";
import {
  cellToWorld,
  createNavGrid,
  findPath,
  nearestWalkable,
  setWalkable,
  simplifyPath,
  worldToCell,
} from "./grid";

function openGrid(w: number, d: number) {
  const g = createNavGrid(-2, -3, w, d);
  g.walkable.fill(1);
  return g;
}

describe("nav grid", () => {
  it("converts between world and cells", () => {
    const g = openGrid(6, 6);
    expect(worldToCell(g, -1.5, -2.5)).toEqual({ cx: 0, cz: 0 });
    expect(worldToCell(g, 0.2, 1.9)).toEqual({ cx: 2, cz: 4 });
    expect(cellToWorld(g, { cx: 2, cz: 4 })).toEqual({ x: 0.5, z: 1.5 });
  });

  it("walks a straight line and a diagonal", () => {
    const g = openGrid(6, 6);
    const line = findPath(g, { cx: 0, cz: 0 }, { cx: 3, cz: 0 })!;
    expect(line.map((c) => c.cx)).toEqual([0, 1, 2, 3]);
    const diag = findPath(g, { cx: 0, cz: 0 }, { cx: 3, cz: 3 })!;
    expect(diag).toHaveLength(4);
  });

  it("goes around an obstacle", () => {
    const g = openGrid(7, 5);
    for (let cz = 0; cz < 4; cz++) setWalkable(g, 3, cz, false);
    const path = findPath(g, { cx: 0, cz: 0 }, { cx: 6, cz: 0 })!;
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ cx: 0, cz: 0 });
    expect(path[path.length - 1]).toEqual({ cx: 6, cz: 0 });
    expect(path.some((c) => c.cx === 3 && c.cz === 4)).toBe(true);
    for (const c of path) expect(g.walkable[c.cz * g.width + c.cx]).toBe(1);
  });

  it("does not cut corners", () => {
    const g = openGrid(3, 3);
    setWalkable(g, 1, 0, false);
    setWalkable(g, 0, 1, false);
    // (0,0) -> (1,1) diagonally would squeeze between two blocked cells
    expect(findPath(g, { cx: 0, cz: 0 }, { cx: 1, cz: 1 })).toBeNull();
  });

  it("returns null when walled off or when an endpoint is blocked", () => {
    const g = openGrid(5, 5);
    for (let cz = 0; cz < 5; cz++) setWalkable(g, 2, cz, false);
    expect(findPath(g, { cx: 0, cz: 0 }, { cx: 4, cz: 4 })).toBeNull();
    expect(findPath(g, { cx: 0, cz: 0 }, { cx: 2, cz: 2 })).toBeNull();
  });

  it("finds the nearest walkable cell", () => {
    const g = openGrid(5, 5);
    setWalkable(g, 2, 2, false);
    setWalkable(g, 3, 2, false);
    const near = nearestWalkable(g, { cx: 2, cz: 2 })!;
    expect(Math.abs(near.cx - 2) + Math.abs(near.cz - 2)).toBe(1);
    expect(g.walkable[near.cz * g.width + near.cx]).toBe(1);
    expect(nearestWalkable(g, { cx: 0, cz: 0 })).toEqual({ cx: 0, cz: 0 });
  });

  it("simplifies straight runs to their turns", () => {
    const path = [
      { cx: 0, cz: 0 },
      { cx: 1, cz: 0 },
      { cx: 2, cz: 0 },
      { cx: 3, cz: 1 },
      { cx: 4, cz: 2 },
      { cx: 4, cz: 3 },
    ];
    expect(simplifyPath(path)).toEqual([
      { cx: 0, cz: 0 },
      { cx: 2, cz: 0 },
      { cx: 4, cz: 2 },
      { cx: 4, cz: 3 },
    ]);
  });
});
