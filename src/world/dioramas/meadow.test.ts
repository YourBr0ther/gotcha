import { describe, expect, it } from "vitest";
import { findPath, isWalkable, worldToCell } from "../nav/grid";
import { meadow } from "./meadow";

describe("meadow", () => {
  it("is deterministic and has the named spots on walkable, mutually reachable cells", () => {
    const a = meadow();
    expect(a.blocks.length).toBeGreaterThan(500);
    expect(Object.keys(a.spots).sort()).toEqual(["forage_1", "forage_2", "play_1", "sleep_1"]);
    const cells = Object.values(a.spots).map((s) => worldToCell(a.nav, s.x, s.z));
    for (const c of cells) expect(isWalkable(a.nav, c.cx, c.cz)).toBe(true);
    for (let i = 1; i < cells.length; i++) expect(findPath(a.nav, cells[0], cells[i])).not.toBeNull();
  });

  it("keeps the pond and trees off the navmesh", () => {
    const d = meadow();
    const pond = worldToCell(d.nav, 5.5, -6.5);
    expect(isWalkable(d.nav, pond.cx, pond.cz)).toBe(false);
    const trunk = worldToCell(d.nav, -12.5, -2.5);
    expect(isWalkable(d.nav, trunk.cx, trunk.cz)).toBe(false);
    expect(d.water).toHaveLength(1);
  });
});
