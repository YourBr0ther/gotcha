/**
 * Shared scaffolding for the voxel dioramas: a seeded random, a block list,
 * the land navmesh and the water navmesh, and the recurring shapes (ground
 * columns, trees, water). Every diorama is built once from a fixed seed so
 * the layout is the same on every load.
 */

import type { BlockId } from "../blocks/palette";
import { createNavGrid, isWalkable, setWalkable, type NavGrid } from "../nav/grid";
import type { AirVolume, BlockInstance, DioramaDef, Falls, Spot, WaterVolume } from "./types";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A grey tint: 1 leaves the block colour alone, 0.9 darkens it a tenth. */
export function mixTint(f: number): number {
  const v = Math.max(0, Math.min(255, Math.round(255 * f)));
  return (v << 16) | (v << 8) | v;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The footprint every diorama shares, so the fixed camera frames them all alike. */
export const DEFAULT_BOUNDS: Bounds = { minX: -14, maxX: 13, minZ: -22, maxZ: 7 };

/** The narrow wedge the portrait camera sees, around which spots are placed. */
export const SUBJECT = { x: 0.5, z: 1.5 };

export interface TreeOptions {
  trunk?: BlockId;
  leaves?: BlockId[];
  height?: number;
  /** Canopy radius at its widest. */
  radius?: number;
  shape?: "round" | "cone" | "palm";
}

export class SceneBuilder {
  readonly blocks: BlockInstance[] = [];
  readonly nav: NavGrid;
  readonly swimNav: NavGrid;
  readonly water: WaterVolume[] = [];
  readonly falls: Falls[] = [];
  readonly air: AirVolume[] = [];
  readonly rand: () => number;
  private readonly reserved = new Set<string>();

  constructor(
    readonly bounds: Bounds,
    seed: number,
  ) {
    this.rand = mulberry32(seed);
    const w = bounds.maxX - bounds.minX + 1;
    const d = bounds.maxZ - bounds.minZ + 1;
    this.nav = createNavGrid(bounds.minX, bounds.minZ, w, d);
    this.swimNav = createNavGrid(bounds.minX, bounds.minZ, w, d);
  }

  block(id: BlockId, x: number, y: number, z: number, extra: Partial<BlockInstance> = {}): void {
    this.blocks.push({ block: id, x, y, z, ...extra });
  }

  inBounds(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  walkable(x: number, z: number, value: boolean): void {
    setWalkable(this.nav, x - this.bounds.minX, z - this.bounds.minZ, value);
  }

  isWalkable(x: number, z: number): boolean {
    return isWalkable(this.nav, x - this.bounds.minX, z - this.bounds.minZ);
  }

  /** Keep decoration off a spot's cell. */
  reserve(spot: Spot): void {
    this.reserved.add(`${Math.floor(spot.x)},${Math.floor(spot.z)}`);
  }

  isReserved(x: number, z: number): boolean {
    return this.reserved.has(`${x},${z}`);
  }

  /** Every cell in bounds, for ground fills. */
  forEachCell(fn: (x: number, z: number) => void): void {
    for (let z = this.bounds.minZ; z <= this.bounds.maxZ; z++) {
      for (let x = this.bounds.minX; x <= this.bounds.maxX; x++) fn(x, z);
    }
  }

  /**
   * A ground column whose top block sits at `h - 1` (so a creature stands at
   * y = h) with `fill` exposed on any step face a lower neighbour reveals.
   */
  column(top: BlockId, fill: BlockId, x: number, z: number, h: number, heightAt: (x: number, z: number) => number, tint?: number): void {
    this.block(top, x, h - 1, z, tint !== undefined ? { tint } : {});
    const lowest = Math.min(heightAt(x + 1, z), heightAt(x - 1, z), heightAt(x, z + 1), heightAt(x, z - 1));
    for (let y = lowest; y < h - 1; y++) this.block(fill, x, y, z);
  }

  tree(x: number, z: number, base: number, options: TreeOptions = {}): void {
    const trunk = options.trunk ?? "log";
    const leaves = options.leaves ?? ["leaves_dark", "leaves", "leaves_light"];
    const height = options.height ?? 5 + Math.floor(this.rand() * 2);
    const radius = options.radius ?? 2;
    const shape = options.shape ?? "round";
    const leaf = () => leaves[Math.min(leaves.length - 1, Math.floor(this.rand() * leaves.length))];
    // Canopy layers run from the darkest shade underneath to the lightest on
    // top, with a little mixing so no layer is one flat colour.
    const shade = (t: number) => {
      const i = Math.round(t * (leaves.length - 1)) + (this.rand() < 0.25 ? (this.rand() < 0.5 ? -1 : 1) : 0);
      return leaves[Math.max(0, Math.min(leaves.length - 1, i))];
    };
    for (let y = 0; y < height; y++) this.block(trunk, x, base + y, z);
    this.walkable(x, z, false);
    const top = base + height;
    if (shape === "palm") {
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ]) {
        const far = Math.abs(dx) + Math.abs(dz) >= 2;
        this.block("leaves_palm", x + dx, top - (far ? 0.5 : 0), z + dz);
      }
      return;
    }
    if (shape === "cone") {
      let layer = 0;
      for (let y = top - height + 2; y <= top + 1; y++) {
        const r = Math.max(0, Math.round(radius * (1 - (layer / (height + 1)) ** 1.3)) - (layer % 2 === 0 ? 0 : 1));
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
            if (dx === 0 && dz === 0 && y < top) continue;
            this.block(leaf(), x + dx, y, z + dz);
          }
        }
        layer++;
      }
      this.block(leaf(), x, top + 2, z);
      return;
    }
    // Round: a wide dark skirt, a full middle, a narrower light crown and a cap.
    const layers: Array<{ dy: number; r: number; t: number }> =
      radius >= 3
        ? [
            { dy: -2, r: radius - 1, t: 0 },
            { dy: -1, r: radius, t: 0.2 },
            { dy: 0, r: radius, t: 0.5 },
            { dy: 1, r: radius - 1, t: 0.75 },
            { dy: 2, r: radius - 2, t: 1 },
          ]
        : [
            { dy: -1, r: radius, t: 0 },
            { dy: 0, r: radius, t: 0.45 },
            { dy: 1, r: radius - 1, t: 0.85 },
          ];
    for (const { dy, r, t } of layers) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          // Trim most corners so the canopy rounds off, and leave the trunk column open below the crown.
          if (Math.abs(dx) === r && Math.abs(dz) === r && (r > 1 || this.rand() < 0.6)) continue;
          if (r >= 3 && Math.abs(dx) + Math.abs(dz) > r + 1 && this.rand() < 0.7) continue;
          if (dx === 0 && dz === 0 && dy < 1) continue;
          this.block(shade(t), x + dx, top + dy, z + dz);
        }
      }
    }
    const capY = top + (radius >= 3 ? 3 : 2);
    this.block(shade(1), x, capY, z);
    if (this.rand() < 0.6) this.block(shade(1), x + (this.rand() < 0.5 ? 1 : -1), capY, z);
    if (radius >= 3 && this.rand() < 0.6) this.block(shade(1), x, capY, z + (this.rand() < 0.5 ? 1 : -1));
  }

  /** A stem with a cap; white and pink daisies get a yellow centre. */
  flower(x: number, z: number, kind: "flower_white" | "flower_pink" | "flower_yellow", y = 0): void {
    this.block("stem", x, y, z);
    this.block(kind, x, y + 0.42, z, { rotationY: this.rand() * Math.PI * 0.5 });
    if (kind !== "flower_yellow") this.block("flower_centre", x, y + 0.56, z);
  }

  mushroom(x: number, z: number, cap: "mushroom_red" | "mushroom_brown", y = 0): void {
    this.block("mushroom_stem", x, y, z);
    this.block(cap, x, y + 0.4, z, { rotationY: this.rand() * Math.PI * 0.5 });
  }

  /** A water volume; its cells leave the land navmesh and, unless it is marked unswimmable, join the swim one. */
  addWater(volume: WaterVolume): void {
    this.water.push(volume);
    for (let z = volume.z; z < volume.z + volume.d; z++) {
      for (let x = volume.x; x < volume.x + volume.w; x++) {
        this.walkable(x, z, false);
        if (volume.swimmable !== false) setWalkable(this.swimNav, x - this.bounds.minX, z - this.bounds.minZ, true);
      }
    }
  }

  /** A waterfall sheet; purely visual, the volumes above and below decide where a creature may go. */
  addFalls(falls: Falls): void {
    this.falls.push(falls);
  }

  inWater(x: number, z: number): boolean {
    return this.water.some((w) => x >= w.x && x < w.x + w.w && z >= w.z && z < w.z + w.d);
  }

  addAir(volume: AirVolume): void {
    this.air.push(volume);
  }

  /** Spread small props over free walkable cells. `place` returns true when it used the cell. */
  scatter(chance: number, place: (x: number, z: number) => boolean | void): void {
    this.forEachCell((x, z) => {
      if (!this.isWalkable(x, z) || this.isReserved(x, z)) return;
      if (this.rand() >= chance) return;
      if (place(x, z)) this.walkable(x, z, false);
    });
  }

  finish(def: Omit<DioramaDef, "blocks" | "water" | "falls" | "air" | "nav" | "swimNav">): DioramaDef {
    return { ...def, blocks: this.blocks, water: this.water, falls: this.falls, air: this.air, nav: this.nav, swimNav: this.swimNav };
  }
}

/** Build-once cache so each diorama is generated a single time per page. */
export function once(build: () => DioramaDef): () => DioramaDef {
  let cached: DioramaDef | null = null;
  return () => {
    if (!cached) cached = build();
    return cached;
  };
}
