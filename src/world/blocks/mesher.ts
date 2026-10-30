/**
 * Turns a diorama's block list into one merged geometry with Minecraft-style
 * smooth lighting baked into the vertex colours. Full blocks are culled
 * against their neighbours and get per-vertex ambient occlusion from the
 * three blocks touching each corner; small props draw as plain boxes with a
 * darker foot so they sit on the ground. One geometry per material means a
 * diorama costs two draw calls, lit and emissive, instead of one per block
 * kind. Pure three.js maths, no DOM, so it runs under vitest.
 */

import * as THREE from "three";
import type { BedrockFaceName } from "../bedrock/types";
import type { BlockInstance } from "../dioramas/types";
import { BLOCKS, faceColor, topColorAt, type BlockId } from "./palette";

/** Brightness for ambient occlusion level 0 (two sides blocked) through 3 (open). */
export const AO_LEVELS: readonly [number, number, number, number] = [0.52, 0.7, 0.86, 1];

/**
 * The classic rule: a vertex with both of its side neighbours filled is in a
 * full crease whatever the corner holds; otherwise each filled block takes
 * one level off.
 */
export function vertexAo(side1: boolean, side2: boolean, corner: boolean): 0 | 1 | 2 | 3 {
  if (side1 && side2) return 0;
  return (3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0))) as 0 | 1 | 2 | 3;
}

interface Face {
  name: BedrockFaceName;
  n: [number, number, number];
  /** Tangents chosen so u x v = n, which keeps the quad counter-clockwise from outside. */
  u: [number, number, number];
  v: [number, number, number];
}

const FACES: readonly Face[] = [
  { name: "east", n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { name: "west", n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { name: "up", n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { name: "down", n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { name: "south", n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { name: "north", n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** Corner order around a quad: (-u,-v), (+u,-v), (+u,+v), (-u,+v). */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export interface MeshBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface VoxelGeometry {
  lit: THREE.BufferGeometry;
  /** Null when the scene has no glowing blocks. */
  emissive: THREE.BufferGeometry | null;
  /** How many quads were emitted after culling, for the budget notes. */
  quads: number;
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function isFull(b: BlockInstance): boolean {
  return !BLOCKS[b.block].size && !BLOCKS[b.block].emissive;
}

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  quads = 0;

  quad(corners: ReadonlyArray<readonly [number, number, number]>, n: readonly [number, number, number], colors: ReadonlyArray<THREE.Color>, ao: readonly number[]): void {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(corners[i][0], corners[i][1], corners[i][2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(colors[i].r, colors[i].g, colors[i].b);
    }
    // Split along whichever diagonal keeps the darker pair of corners from
    // bleeding across the quad; without this creases show as an X pattern.
    if (ao[0] + ao[2] > ao[1] + ao[3]) this.indices.push(base + 1, base + 2, base + 3, base + 3, base, base + 1);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.quads++;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Multiply a face's sRGB colour by an instance tint and convert to linear. */
function linearColor(hex: number, tint: number | undefined, out: THREE.Color): THREE.Color {
  out.setHex(hex);
  if (tint !== undefined) out.multiply(new THREE.Color(tint));
  return out.convertSRGBToLinear();
}

/**
 * Build the merged geometries. `bounds` lets the mesher treat everything
 * past the diorama's edge and below its floor as solid rock, so the outer
 * walls of the ground slab, which the fixed camera never sees, are skipped.
 */
export function buildVoxelGeometry(blocks: readonly BlockInstance[], bounds?: MeshBounds): VoxelGeometry {
  const solid = new Map<string, BlockInstance>();
  let minY = Infinity;
  for (const b of blocks) {
    if (!isFull(b)) continue;
    solid.set(key(b.x, b.y, b.z), b);
    if (b.y < minY) minY = b.y;
  }
  const occupied = (x: number, y: number, z: number) => solid.has(key(x, y, z));
  const hidden = (x: number, y: number, z: number) => {
    if (occupied(x, y, z)) return true;
    if (y < minY) return true;
    // Beyond the edge counts as solid only at ground level, so a canopy that
    // leans past the bound still draws its outer faces.
    return !!bounds && y <= 2 && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ);
  };

  const lit = new Builder();
  const glow = new Builder();
  const cols = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  const top = new THREE.Color();
  const side = new THREE.Color();
  const tint = new THREE.Color();
  const corner: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const ao = [3, 3, 3, 3];

  for (const b of blocks) {
    const def = BLOCKS[b.block];
    if (isFull(b)) {
      const cx = b.x + 0.5;
      const cy = b.y + 0.5;
      const cz = b.z + 0.5;
      const varied = def.variation ? topColorAt(b.block, b.x, b.z, top) : null;
      for (const f of FACES) {
        const nx = b.x + f.n[0];
        const ny = b.y + f.n[1];
        const nz = b.z + f.n[2];
        if (hidden(nx, ny, nz)) continue;
        for (let i = 0; i < 4; i++) {
          const [su, sv] = CORNERS[i];
          corner[i][0] = cx + f.n[0] * 0.5 + f.u[0] * su * 0.5 + f.v[0] * sv * 0.5;
          corner[i][1] = cy + f.n[1] * 0.5 + f.u[1] * su * 0.5 + f.v[1] * sv * 0.5;
          corner[i][2] = cz + f.n[2] * 0.5 + f.u[2] * su * 0.5 + f.v[2] * sv * 0.5;
          const s1 = occupied(nx + f.u[0] * su, ny + f.u[1] * su, nz + f.u[2] * su);
          const s2 = occupied(nx + f.v[0] * sv, ny + f.v[1] * sv, nz + f.v[2] * sv);
          const c = occupied(nx + f.u[0] * su + f.v[0] * sv, ny + f.u[1] * su + f.v[1] * sv, nz + f.u[2] * su + f.v[2] * sv);
          ao[i] = vertexAo(s1, s2, c);
          const level = AO_LEVELS[ao[i]];
          if (f.name === "up" && varied) {
            cols[i].copy(varied);
            if (b.tint !== undefined) cols[i].multiply(tint.setHex(b.tint));
            cols[i].convertSRGBToLinear();
          } else if (f.name !== "up" && f.name !== "down" && def.sideFade) {
            // Grass drapes: the upper edge carries the top colour down over the dirt.
            linearColor(faceColor(def, f.name), b.tint, side);
            const over = varied ? cols[i].copy(varied) : cols[i].setHex(def.colors.top);
            if (b.tint !== undefined) over.multiply(tint.setHex(b.tint));
            over.convertSRGBToLinear();
            cols[i].copy(sv > 0 ? over.multiplyScalar(0.82) : side);
          } else {
            linearColor(faceColor(def, f.name), b.tint, cols[i]);
          }
          cols[i].multiplyScalar(level);
        }
        lit.quad(corner, f.n, cols, ao);
      }
      continue;
    }

    // Small props and glowing crystals: a box the size the palette says,
    // centred on the instance, turned by its yaw, no neighbour culling.
    const [sx, sy, sz] = def.size ?? [1, 1, 1];
    const yaw = b.rotationY ?? 0;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const target = def.emissive ? glow : lit;
    const boost = def.emissive ? 1.6 : 1;
    for (const f of FACES) {
      for (let i = 0; i < 4; i++) {
        const [su, sv] = CORNERS[i];
        const lx = (f.n[0] + f.u[0] * su + f.v[0] * sv) * sx * 0.5;
        const ly = (f.n[1] + f.u[1] * su + f.v[1] * sv) * sy * 0.5 + sy * 0.5;
        const lz = (f.n[2] + f.u[2] * su + f.v[2] * sv) * sz * 0.5;
        corner[i][0] = b.x + lx * cosY + lz * sinY;
        corner[i][1] = b.y + ly;
        corner[i][2] = b.z - lx * sinY + lz * cosY;
        // Lower vertices sit against the ground, so they take a touch of shade.
        const low = ly < sy * 0.25 && f.name !== "up";
        ao[i] = low ? 1 : 3;
        linearColor(faceColor(def, f.name), b.tint, cols[i]).multiplyScalar((def.emissive ? 1 : AO_LEVELS[ao[i]]) * boost);
      }
      const n: [number, number, number] = [f.n[0] * cosY + f.n[2] * sinY, f.n[1], -f.n[0] * sinY + f.n[2] * cosY];
      target.quad(corner, n, cols, ao);
    }
  }

  return { lit: lit.build(), emissive: glow.quads ? glow.build() : null, quads: lit.quads + glow.quads };
}

/** Every cell that has a full block of the given kind on top, with nothing solid above it. */
export function exposedTops(blocks: readonly BlockInstance[], kind: BlockId): Array<{ x: number; y: number; z: number }> {
  const solid = new Set<string>();
  for (const b of blocks) if (isFull(b)) solid.add(key(b.x, b.y, b.z));
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const b of blocks) {
    if (b.block !== kind || !isFull(b)) continue;
    if (solid.has(key(b.x, b.y + 1, b.z))) continue;
    out.push({ x: b.x, y: b.y + 1, z: b.z });
  }
  return out;
}
