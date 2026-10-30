import { describe, expect, it } from "vitest";
import type { BlockInstance } from "../dioramas/types";
import { AO_LEVELS, buildVoxelGeometry, exposedTops, vertexAo } from "./mesher";
import { hashCell, topColorAt } from "./palette";

function block(block: BlockInstance["block"], x: number, y: number, z: number): BlockInstance {
  return { block, x, y, z };
}

/** Colours of the vertices on the top face of the block at the origin, keyed by corner. */
function topFaceColors(g: ReturnType<typeof buildVoxelGeometry>["lit"], cell: { x: number; y: number; z: number }) {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = g.getAttribute("color");
  const out = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    if (nor.getY(i) !== 1 || pos.getY(i) !== cell.y + 1) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x < cell.x || x > cell.x + 1 || z < cell.z || z > cell.z + 1) continue;
    out.set(`${x - cell.x},${z - cell.z}`, col.getX(i) + col.getY(i) + col.getZ(i));
  }
  return out;
}

describe("vertexAo", () => {
  it("counts filled neighbours and treats two sides as a full crease", () => {
    expect(vertexAo(false, false, false)).toBe(3);
    expect(vertexAo(true, false, false)).toBe(2);
    expect(vertexAo(false, false, true)).toBe(2);
    expect(vertexAo(true, false, true)).toBe(1);
    expect(vertexAo(true, true, false)).toBe(0);
    expect(vertexAo(true, true, true)).toBe(0);
  });
});

describe("buildVoxelGeometry", () => {
  it("culls faces between touching full blocks and under the lowest layer", () => {
    const one = buildVoxelGeometry([block("stone", 0, 0, 0)]);
    const two = buildVoxelGeometry([block("stone", 0, 0, 0), block("stone", 1, 0, 0)]);
    // Nothing ever sees the underside of the lowest layer, so a lone cube is five faces.
    expect(one.quads).toBe(5);
    // Two cubes share a face: 10 minus the 2 hidden.
    expect(two.quads).toBe(8);
    // A cube above another draws its bottom only when the one below is missing.
    expect(buildVoxelGeometry([block("stone", 0, 0, 0), block("stone", 0, 2, 0)]).quads).toBe(11);
  });

  it("darkens the top-face corners that touch a wall and a step", () => {
    // Floor at (0,0,0); a wall block to the east and one to the north of its top face.
    const blocks = [block("stone", 0, 0, 0), block("stone", 1, 1, 0), block("stone", 0, 1, -1)];
    const g = buildVoxelGeometry(blocks).lit;
    const colors = topFaceColors(g, { x: 0, y: 0, z: 0 });
    const open = colors.get("0,1")!; // south-west corner: nothing around it
    const eastEdge = colors.get("1,1")!; // touches the east wall only
    const northEdge = colors.get("0,0")!; // touches the north wall only
    const crease = colors.get("1,0")!; // both walls meet here
    expect(eastEdge).toBeCloseTo(open * (AO_LEVELS[2] / AO_LEVELS[3]), 5);
    expect(northEdge).toBeCloseTo(eastEdge, 5);
    expect(crease).toBeCloseTo(open * (AO_LEVELS[0] / AO_LEVELS[3]), 5);
  });

  it("gives a diagonal-only neighbour one level of shade", () => {
    const blocks = [block("stone", 0, 0, 0), block("stone", 1, 1, -1)];
    const colors = topFaceColors(buildVoxelGeometry(blocks).lit, { x: 0, y: 0, z: 0 });
    expect(colors.get("1,0")!).toBeCloseTo(colors.get("0,1")! * (AO_LEVELS[2] / AO_LEVELS[3]), 5);
  });

  it("puts glowing blocks in their own geometry and props in the lit one", () => {
    const out = buildVoxelGeometry([block("grass", 0, 0, 0), block("crystal_cyan", 0.3, 1, 0.3), block("flower_white", 0.5, 1, 0.5)]);
    expect(out.emissive).not.toBeNull();
    expect(out.emissive!.getAttribute("position").count).toBe(24);
    // Grass: 5 faces (its bottom is the floor); flower: all 6 faces of a small box.
    expect(out.lit.getAttribute("position").count).toBe(44);
  });

  it("skips the outer walls of the ground slab when bounds are given", () => {
    const slab = [block("dirt", 0, -1, 0), block("dirt", 1, -1, 0)];
    const open = buildVoxelGeometry(slab);
    const bounded = buildVoxelGeometry(slab, { minX: 0, maxX: 1, minZ: 0, maxZ: 0 });
    expect(open.quads).toBe(8);
    // Only the two tops remain: the sides are past the edge.
    expect(bounded.quads).toBe(2);
  });

  it("lists the exposed tops of a kind", () => {
    const tops = exposedTops([block("grass", 0, 0, 0), block("grass", 1, 0, 0), block("log", 1, 1, 0)], "grass");
    expect(tops).toEqual([{ x: 0, y: 1, z: 0 }]);
  });
});

describe("grass variation", () => {
  it("hashes a cell the same way every time and differs between cells", () => {
    expect(hashCell(3, -7)).toBe(hashCell(3, -7));
    expect(hashCell(3, -7)).not.toBe(hashCell(4, -7));
    expect(hashCell(3, -7)).not.toBe(hashCell(3, -7, 1));
    for (const [x, z] of [
      [0, 0],
      [-14, 7],
      [13, -22],
    ]) {
      const h = hashCell(x, z);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("keeps grass between its two shades and stable across builds", () => {
    const a = topColorAt("grass", 2, -3);
    const b = topColorAt("grass", 2, -3);
    expect(a.getHex()).toBe(b.getHex());
    const hexes = new Set<number>();
    for (let x = -5; x < 5; x++) hexes.add(topColorAt("grass", x, 1).getHex());
    expect(hexes.size).toBeGreaterThan(5);
    // Dirt has no variation, so it is always its top colour.
    expect(topColorAt("dirt", 9, 9).getHex()).toBe(0x8a5f3a);
  });
});
