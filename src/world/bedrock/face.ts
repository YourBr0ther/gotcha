/**
 * Where a species' face lives on its texture, for UI that wants a portrait
 * without a renderer: the biggest cube under any bone with "head" in its
 * name, and the texel rectangle of its north (front) face. A
 * `background-position` crop of the texture at that rectangle shows the
 * face the model wears. Cobblemon rigs often keep the cubes on a child of
 * the bone called `head` (Eevee's are on `head_angle`), so every head-named
 * bone is searched, not just the first.
 */

import type { PokemonBundle } from "../api";
import type { BedrockBone, BedrockCube, BedrockGeometryFile, Vec3 } from "./types";

export interface FaceRect {
  /** Texel rectangle of the front face, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  textureWidth: number;
  textureHeight: number;
}

export interface FaceSprite extends FaceRect {
  /** The texture to crop, versioned like every other asset URL. */
  url: string;
}

function faceArea(cube: BedrockCube): number {
  const [dx, dy] = cube.size ?? [0, 0, 0];
  return dx * dy;
}

/** Every bone with "head" in its name, in file order. */
export function findHeadBones(bones: BedrockBone[]): BedrockBone[] {
  return bones.filter((b) => b.name.toLowerCase().includes("head"));
}

/** The north face's texel rectangle, from box UV or the per-face map. */
export function northFaceRect(cube: BedrockCube): Omit<FaceRect, "textureWidth" | "textureHeight"> | undefined {
  const size: Vec3 = cube.size ?? [0, 0, 0];
  const [dx, dy, dz] = size;
  if (dx <= 0 || dy <= 0) return undefined;
  const uv = cube.uv;
  if (uv === undefined) return undefined;
  if (Array.isArray(uv)) {
    // Box UV net: north sits right of the east strip, below the top.
    return { x: uv[0] + dz, y: uv[1] + dz, width: dx, height: dy };
  }
  const north = uv.north;
  if (!north) return undefined;
  const [w, h] = north.uv_size ?? [dx, dy];
  if (w <= 0 || h <= 0) return undefined;
  return { x: north.uv[0], y: north.uv[1], width: w, height: h };
}

/** The face rectangle of a geometry file, or undefined when it has no usable head. */
export function faceRect(file: BedrockGeometryFile): FaceRect | undefined {
  const geo = file["minecraft:geometry"]?.[0];
  if (!geo) return undefined;
  const cubes = findHeadBones(geo.bones ?? [])
    .flatMap((b) => b.cubes ?? [])
    .sort((a, b) => faceArea(b) - faceArea(a));
  for (const cube of cubes) {
    const rect = northFaceRect(cube);
    if (rect) {
      return {
        ...rect,
        textureWidth: geo.description.texture_width ?? 64,
        textureHeight: geo.description.texture_height ?? 64,
      };
    }
  }
  return undefined;
}

/** The face crop and the texture to take it from, for a bundle. */
export function faceSprite(bundle: Pick<PokemonBundle, "geometry" | "textures">): FaceSprite | undefined {
  const rect = faceRect(bundle.geometry);
  if (!rect) return undefined;
  return { ...rect, url: bundle.textures.base };
}
