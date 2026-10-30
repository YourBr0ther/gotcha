import type { BlockId } from "../blocks/palette";
import type { NavGrid } from "../nav/grid";

export interface BlockInstance {
  block: BlockId;
  x: number;
  y: number;
  z: number;
  /** Multiplied into the block colour for variation. */
  tint?: number;
  /** Yaw in radians, for logs lying on their side and the like. */
  rotationY?: number;
}

export interface WaterPatch {
  /** Minimum corner in blocks and size in blocks; `y` is the surface height. */
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
}

export interface Spot {
  x: number;
  z: number;
  /** Yaw the creature settles into, radians. */
  facing?: number;
}

export interface DioramaDef {
  id: string;
  blocks: BlockInstance[];
  water: WaterPatch[];
  spots: Record<string, Spot>;
  nav: NavGrid;
  /** Where a creature appears before any moveTo. */
  spawn: Spot;
}
