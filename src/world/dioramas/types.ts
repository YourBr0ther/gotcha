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

/** A box of water. `y` is the surface; the floor is `depth` below it. */
export interface WaterVolume {
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
  depth: number;
}

/** A box of air a flier may hover in, above the ground between `yMin` and `yMax`. */
export interface AirVolume {
  x: number;
  z: number;
  w: number;
  d: number;
  yMin: number;
  yMax: number;
}

export type Medium = "land" | "water" | "air";

export interface Spot {
  x: number;
  z: number;
  /** Yaw the creature settles into, radians. */
  facing?: number;
  /** What the spot is in. Land when omitted. */
  medium?: Medium;
  /** Hover height for an air spot. */
  y?: number;
}

export interface PointLightDef {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

/** How the day and night rig is scaled and tinted inside this scene. */
export interface LightRig {
  /** Multiplier on the sun's intensity. */
  sun: number;
  /** Multiplier on the hemisphere light. */
  hemi: number;
  fogNear: number;
  fogFar: number;
  /** Fixed sky and fog colours for an enclosed scene; omitted means the clock decides. */
  sky?: number;
  fog?: number;
  /** Always-on lights, for crystals and the like. */
  points?: PointLightDef[];
}

export type BackdropStyle = "trees" | "spruce" | "palms" | "rock" | "reeds";

/** The blurred painted wall behind the far edge of the scene. */
export interface Backdrop {
  style: BackdropStyle;
  /** Top of the sky at midday; the clock tints it. */
  sky: number;
  horizon: number;
  /** Colour of the silhouettes. */
  silhouette: number;
  /** World Z of the plane. */
  z: number;
  height: number;
}

export interface Framing {
  /** Where the creature stands when the shot was composed. */
  subject: { x: number; z: number };
}

export type ParticleKind = "snow" | "spores" | "none";

export interface DioramaDef {
  id: string;
  blocks: BlockInstance[];
  water: WaterVolume[];
  air: AirVolume[];
  spots: Record<string, Spot>;
  /** Walkable ground. */
  nav: NavGrid;
  /** Cells inside a water volume, same origin and size as `nav`. */
  swimNav: NavGrid;
  /** Where a creature appears before any moveTo. */
  spawn: Spot;
  lights: LightRig;
  backdrop: Backdrop;
  framing: Framing;
  particles: ParticleKind;
}
