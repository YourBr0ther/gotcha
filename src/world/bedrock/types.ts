/**
 * Shapes of the Bedrock JSON files Cobblemon ships. These are the raw
 * on-disk formats, so they contain no three.js types and can be imported
 * from anywhere (the .cpkmn package carries these same files as members).
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type BedrockFaceName = "north" | "south" | "east" | "west" | "up" | "down";

export interface BedrockFaceUv {
  uv: Vec2;
  uv_size?: Vec2;
  material_instance?: string;
}

export type BedrockPerFaceUv = Partial<Record<BedrockFaceName, BedrockFaceUv>>;

export interface BedrockCube {
  origin?: Vec3;
  size?: Vec3;
  /** Box UV offset, or a per-face map. */
  uv?: Vec2 | BedrockPerFaceUv;
  inflate?: number;
  mirror?: boolean;
  pivot?: Vec3;
  rotation?: Vec3;
}

export interface BedrockBone {
  name: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  inflate?: number;
  cubes?: BedrockCube[];
  locators?: Record<string, Vec3 | { offset?: Vec3; rotation?: Vec3 }>;
}

export interface BedrockGeometryDescription {
  identifier: string;
  texture_width?: number;
  texture_height?: number;
  visible_bounds_width?: number;
  visible_bounds_height?: number;
  visible_bounds_offset?: Vec3;
}

export interface BedrockGeometry {
  description: BedrockGeometryDescription;
  bones?: BedrockBone[];
}

export interface BedrockGeometryFile {
  format_version: string;
  "minecraft:geometry": BedrockGeometry[];
}

/** A keyframe component is a number or a Molang expression string. */
export type MolangValue = number | string;
export type MolangVec3 = [MolangValue, MolangValue, MolangValue];

export interface BedrockKeyframeObject {
  pre?: MolangVec3 | MolangValue;
  post?: MolangVec3 | MolangValue;
  lerp_mode?: "linear" | "catmullrom";
}

export type BedrockKeyframe = MolangVec3 | MolangValue | BedrockKeyframeObject;

/** Either a constant vector, or a map of time (as a string) to keyframe. */
export type BedrockChannel = MolangVec3 | MolangValue | Record<string, BedrockKeyframe>;

export interface BedrockBoneAnimation {
  rotation?: BedrockChannel;
  position?: BedrockChannel;
  scale?: BedrockChannel;
}

export interface BedrockAnimation {
  loop?: boolean | "hold_on_last_frame";
  animation_length?: number;
  override_previous_animation?: boolean;
  anim_time_update?: string;
  blend_weight?: MolangValue;
  bones?: Record<string, BedrockBoneAnimation>;
  particle_effects?: unknown;
  sound_effects?: unknown;
}

export interface BedrockAnimationFile {
  format_version: string;
  animations: Record<string, BedrockAnimation>;
}

/** Cobblemon's JSON poser, trimmed to what the renderer reads. */
export interface PoserPose {
  poseName?: string;
  poseTypes?: string[];
  transformTicks?: number;
  /** Molang calls; a few posers add `{ animation, condition }` objects, which the reader skips. */
  animations?: Array<string | { animation?: string; condition?: string }>;
  quirks?: Array<string | { animation?: string; condition?: string }>;
  isBattle?: boolean;
  [key: string]: unknown;
}

export interface PoserFile {
  portraitScale?: number;
  portraitTranslation?: Vec3;
  profileScale?: number;
  profileTranslation?: Vec3;
  faint?: string;
  cry?: string;
  poses?: Record<string, PoserPose>;
  [key: string]: unknown;
}
