/**
 * Bedrock `.geo.json` to a three.js Group hierarchy.
 *
 * COORDINATE CONVENTION (the one place it is written down)
 * ---------------------------------------------------------
 * Bedrock geometry JSON is a left-handed, Y-up frame where +X points west.
 * three.js is right-handed, Y-up, +X east. The mapping is therefore an X
 * mirror on positions and the matching sign change on rotations:
 *
 *   position  (x, y, z)     ->  (-x, y, z) / 16       (16 units = 1 block)
 *   rotation  (rx, ry, rz)  ->  Euler(-rx, -ry, rz) in degrees, order "ZYX"
 *
 * The negated X and Y rotation is what Minecraft's own `ModelPart` ends up
 * applying after its render-time flip, and what Blockbench's Bedrock codec
 * applies when it displays the model, so a +X bone rotation pitches the front
 * of the bone down, the same as in game. A model built facing "north" in
 * Blockbench faces -Z here.
 *
 * Box UV is Minecraft's unfolded net. Seen from outside each face, with +Y
 * as up for the sides, north as up for the top and south as up for the
 * bottom (which is how three.js's BoxGeometry orients its faces), the
 * texel rectangles (top-left -> bottom-right) are:
 *
 *   east   (u,          v+dz) -> (u+dz,       v+dz+dy)
 *   north  (u+dz,       v+dz) -> (u+dz+dx,    v+dz+dy)
 *   west   (u+dz+dx,    v+dz) -> (u+2dz+dx,   v+dz+dy)
 *   south  (u+2dz+dx,   v+dz) -> (u+2dz+2dx,  v+dz+dy)
 *   up     (u+dz+dx,    v+dz) -> (u+dz,       v)
 *   down   (u+dz+2dx,   v)    -> (u+dz+dx,    v+dz)
 *
 * `mirror` is a geometric X mirror of the cube: east and west swap slots and
 * every face flips in U. Per-face `uv` objects are used as given, except
 * `down`, whose author-facing orientation has north at the top and so flips
 * in V to match BoxGeometry. `inflate` grows the box on every side and leaves
 * UV alone.
 *
 * A cube with a zero X size is a sheet seen edge-on from the front: a tail,
 * a fin, a head leaf. Its two coincident faces point east and west, so one
 * of them always faces away from the sun and the fill, and whichever the
 * camera sees is lit by the hemisphere alone (Pikachu's tail drew olive
 * next to a yellow body). Minecraft shades every face by a fixed direction
 * and never shows this. Here such a sheet takes the model's front normal
 * on both faces, so it lights like the face of the creature it belongs to.
 * Sheets flat in Y or Z already carry the normals of a top or a front and
 * are left alone.
 */

import * as THREE from "three";
import type {
  BedrockBone,
  BedrockCube,
  BedrockFaceName,
  BedrockGeometryFile,
  BedrockPerFaceUv,
  Vec3,
} from "./types";

export const BEDROCK_UNITS_PER_BLOCK = 16;
export const BEDROCK_EULER_ORDER = "ZYX" as const;

const DEG = Math.PI / 180;

/** Bedrock position (in Bedrock units) to three.js axes, still in Bedrock units. */
export function bedrockPosition(v: Vec3 | undefined, out = new THREE.Vector3()): THREE.Vector3 {
  if (!v) return out.set(0, 0, 0);
  return out.set(-v[0], v[1], v[2]);
}

/** Bedrock rotation in degrees to a three.js Euler. */
export function bedrockEuler(deg: Vec3 | undefined, out = new THREE.Euler()): THREE.Euler {
  if (!deg) return out.set(0, 0, 0, BEDROCK_EULER_ORDER);
  return out.set(-deg[0] * DEG, -deg[1] * DEG, deg[2] * DEG, BEDROCK_EULER_ORDER);
}

/** The same sign convention applied to an animation rotation delta, in radians. */
export function bedrockRotationDelta(deg: Vec3): Vec3 {
  return [-deg[0] * DEG, -deg[1] * DEG, deg[2] * DEG];
}

/** The same sign convention applied to an animation position delta. */
export function bedrockPositionDelta(v: Vec3): Vec3 {
  return [-v[0], v[1], v[2]];
}

/** Texel rectangle: top-left -> bottom-right as seen from outside the face. */
export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export type FaceRects = Record<BedrockFaceName, UvRect>;

/** BoxGeometry emits its faces in this order. */
export const BOX_FACE_ORDER: readonly BedrockFaceName[] = ["east", "west", "up", "down", "south", "north"];

export function boxUvRects(u: number, v: number, dx: number, dy: number, dz: number, mirror: boolean): FaceRects {
  const rects: FaceRects = {
    east: { u0: u, v0: v + dz, u1: u + dz, v1: v + dz + dy },
    north: { u0: u + dz, v0: v + dz, u1: u + dz + dx, v1: v + dz + dy },
    west: { u0: u + dz + dx, v0: v + dz, u1: u + 2 * dz + dx, v1: v + dz + dy },
    south: { u0: u + 2 * dz + dx, v0: v + dz, u1: u + 2 * dz + 2 * dx, v1: v + dz + dy },
    up: { u0: u + dz + dx, v0: v + dz, u1: u + dz, v1: v },
    down: { u0: u + dz + 2 * dx, v0: v, u1: u + dz + dx, v1: v + dz },
  };
  if (mirror) {
    const east = rects.east;
    rects.east = rects.west;
    rects.west = east;
    for (const name of BOX_FACE_ORDER) {
      const r = rects[name];
      const t = r.u0;
      r.u0 = r.u1;
      r.u1 = t;
    }
  }
  return rects;
}

export function perFaceUvRects(faces: BedrockPerFaceUv): Partial<FaceRects> {
  const out: Partial<FaceRects> = {};
  for (const name of BOX_FACE_ORDER) {
    const f = faces[name];
    if (!f) continue;
    const [x, y] = f.uv;
    const [w, h] = f.uv_size ?? [0, 0];
    out[name] = name === "down" ? { u0: x, v0: y + h, u1: x + w, v1: y } : { u0: x, v0: y, u1: x + w, v1: y + h };
  }
  return out;
}

function applyUvs(geometry: THREE.BoxGeometry, rects: Partial<FaceRects>, texW: number, texH: number): void {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  BOX_FACE_ORDER.forEach((name, face) => {
    const r = rects[name];
    const base = face * 4;
    if (!r) {
      // No texture for this face: collapse it onto one texel so it draws nothing useful but stays valid.
      for (let i = 0; i < 4; i++) uv.setXY(base + i, 0, 1);
      return;
    }
    const ua = r.u0 / texW;
    const ub = r.u1 / texW;
    const va = 1 - r.v0 / texH;
    const vb = 1 - r.v1 / texH;
    // BoxGeometry vertex order per face: (0,1) (1,1) (0,0) (1,0).
    uv.setXY(base + 0, ua, va);
    uv.setXY(base + 1, ub, va);
    uv.setXY(base + 2, ua, vb);
    uv.setXY(base + 3, ub, vb);
  });
  uv.needsUpdate = true;
}

export interface RestPose {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export interface LoadedModel {
  /** Scaled 1/16 so one block is one unit. Bones hang under it in Bedrock units. */
  root: THREE.Group;
  bones: Map<string, THREE.Group>;
  restPose: Map<string, RestPose>;
  textureWidth: number;
  textureHeight: number;
  /** Model bounds in blocks, at rest. */
  bounds: THREE.Box3;
  dispose(): void;
}

export interface BuildOptions {
  /** Which `minecraft:geometry` entry to build. */
  index?: number;
}

function isPerFace(uv: BedrockCube["uv"]): uv is BedrockPerFaceUv {
  return !!uv && !Array.isArray(uv);
}

/** The model's front, the direction a north face points. */
const FRONT_NORMAL: Vec3 = [0, 0, -1];

/** Point every vertex normal of a sheet the same way. */
export function setSheetNormals(geometry: THREE.BufferGeometry, normal: Vec3): void {
  const attr = geometry.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, normal[0], normal[1], normal[2]);
  attr.needsUpdate = true;
}

/** A cube with no thickness along X: its visible faces are east and west. */
export function isSideSheet(size: Vec3): boolean {
  return size[0] === 0 && (size[1] > 0 || size[2] > 0);
}

function buildCube(
  cube: BedrockCube,
  bone: BedrockBone,
  bonePivot: THREE.Vector3,
  material: THREE.Material,
  texW: number,
  texH: number,
): THREE.Object3D {
  const size = cube.size ?? [0, 0, 0];
  const origin = cube.origin ?? [0, 0, 0];
  const inflate = cube.inflate ?? bone.inflate ?? 0;
  const mirror = cube.mirror ?? bone.mirror ?? false;

  const geometry = new THREE.BoxGeometry(
    size[0] + inflate * 2,
    size[1] + inflate * 2,
    size[2] + inflate * 2,
  );
  if (isPerFace(cube.uv)) {
    applyUvs(geometry, perFaceUvRects(cube.uv), texW, texH);
  } else {
    const [u, v] = cube.uv ?? [0, 0];
    applyUvs(geometry, boxUvRects(u, v, size[0], size[1], size[2], mirror), texW, texH);
  }
  if (isSideSheet(size)) setSheetNormals(geometry, FRONT_NORMAL);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  const center = bedrockPosition([
    origin[0] + size[0] / 2,
    origin[1] + size[1] / 2,
    origin[2] + size[2] / 2,
  ]);

  if (cube.rotation && cube.pivot) {
    const pivot = bedrockPosition(cube.pivot);
    const wrapper = new THREE.Group();
    wrapper.position.copy(pivot).sub(bonePivot);
    wrapper.rotation.copy(bedrockEuler(cube.rotation));
    mesh.position.copy(center).sub(pivot);
    wrapper.add(mesh);
    return wrapper;
  }

  mesh.position.copy(center).sub(bonePivot);
  return mesh;
}

/**
 * Build the model. `material` is shared by every cube so the creature draws
 * with one material; pass a `MeshBasicMaterial` in tests where no texture is
 * loaded.
 */
export function buildModel(file: BedrockGeometryFile, material: THREE.Material, options: BuildOptions = {}): LoadedModel {
  const geo = file["minecraft:geometry"]?.[options.index ?? 0];
  if (!geo) throw new Error("No minecraft:geometry entry in file");
  const texW = geo.description.texture_width ?? 64;
  const texH = geo.description.texture_height ?? 64;

  const root = new THREE.Group();
  root.name = geo.description.identifier || "geometry";
  root.scale.setScalar(1 / BEDROCK_UNITS_PER_BLOCK);

  const bones = new Map<string, THREE.Group>();
  const restPose = new Map<string, RestPose>();
  const pivots = new Map<string, THREE.Vector3>();
  const defs = geo.bones ?? [];

  // First pass: create every bone at its absolute pivot so parents can be
  // resolved regardless of order in the file.
  for (const def of defs) {
    const group = new THREE.Group();
    group.name = def.name;
    group.rotation.order = BEDROCK_EULER_ORDER;
    bones.set(def.name, group);
    pivots.set(def.name, bedrockPosition(def.pivot));
  }

  for (const def of defs) {
    const group = bones.get(def.name)!;
    const pivot = pivots.get(def.name)!;
    const parent = def.parent ? bones.get(def.parent) : undefined;
    const parentPivot = def.parent ? pivots.get(def.parent) : undefined;

    group.position.copy(pivot);
    if (parentPivot) group.position.sub(parentPivot);
    group.rotation.copy(bedrockEuler(def.rotation));

    for (const cube of def.cubes ?? []) {
      group.add(buildCube(cube, def, pivot, material, texW, texH));
    }
    for (const [name, loc] of Object.entries(def.locators ?? {})) {
      const marker = new THREE.Group();
      marker.name = `locator:${name}`;
      const offset = Array.isArray(loc) ? loc : loc.offset;
      marker.position.copy(bedrockPosition(offset)).sub(pivot);
      group.add(marker);
    }

    restPose.set(def.name, {
      position: group.position.clone(),
      rotation: group.rotation.clone(),
      scale: new THREE.Vector3(1, 1, 1),
    });

    (parent ?? root).add(group);
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);

  return {
    root,
    bones,
    restPose,
    textureWidth: texW,
    textureHeight: texH,
    bounds,
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
    },
  };
}
