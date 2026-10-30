/**
 * The flat-colour block palette dioramas are built from. Each block is a
 * unit cube with a colour per face baked into vertex colours, so one
 * InstancedMesh with one material draws every block of a kind.
 */

import * as THREE from "three";
import { BOX_FACE_ORDER } from "../bedrock/geometry";
import type { BedrockFaceName } from "../bedrock/types";

export type BlockId =
  | "grass"
  | "dirt"
  | "stone"
  | "sand"
  | "log"
  | "leaves"
  | "leaves_light"
  | "tuft"
  | "stem"
  | "flower_white"
  | "flower_pink"
  | "flower_yellow";

export interface BlockDef {
  /** Per-face colour; `side` covers the four sides when a face is not named. */
  colors: { top: number; bottom?: number; side: number } & Partial<Record<BedrockFaceName, number>>;
  /** Size of the block as a fraction of a unit cube. Defaults to a full block. */
  size?: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export const BLOCKS: Record<BlockId, BlockDef> = {
  grass: { colors: { top: 0x7cc14a, side: 0x8a6a3c, bottom: 0x6f5331 }, receiveShadow: true },
  dirt: { colors: { top: 0x8a6a3c, side: 0x7d5f36, bottom: 0x6f5331 }, receiveShadow: true },
  stone: { colors: { top: 0x9a9a9a, side: 0x858585, bottom: 0x6e6e6e }, castShadow: true, receiveShadow: true },
  sand: { colors: { top: 0xe6d8a6, side: 0xd8c893, bottom: 0xc9b982 }, receiveShadow: true },
  log: { colors: { top: 0xb08a55, bottom: 0xb08a55, side: 0x6b4a2b }, castShadow: true, receiveShadow: true },
  leaves: { colors: { top: 0x4ea83a, side: 0x3f8f2f, bottom: 0x2f6f24 }, castShadow: true, receiveShadow: true },
  leaves_light: { colors: { top: 0x7ad24e, side: 0x62b73f, bottom: 0x3f8f2f }, castShadow: true, receiveShadow: true },
  tuft: { colors: { top: 0x8fd457, side: 0x6fbd44 }, size: [0.55, 0.35, 0.55] },
  stem: { colors: { top: 0x4f9a35, side: 0x4f9a35 }, size: [0.12, 0.45, 0.12] },
  flower_white: { colors: { top: 0xfff6e8, side: 0xf2ead8, bottom: 0xffd45c }, size: [0.34, 0.2, 0.34], castShadow: true },
  flower_pink: { colors: { top: 0xff7bb0, side: 0xf0609a, bottom: 0xffd45c }, size: [0.34, 0.2, 0.34], castShadow: true },
  flower_yellow: { colors: { top: 0xffd64a, side: 0xf3c43a, bottom: 0xe8a81e }, size: [0.3, 0.2, 0.3], castShadow: true },
};

export const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[];

function faceColor(def: BlockDef, face: BedrockFaceName): number {
  const c = def.colors;
  const explicit = c[face];
  if (explicit !== undefined) return explicit;
  if (face === "up") return c.top;
  if (face === "down") return c.bottom ?? c.side;
  return c.side;
}

/** A unit BoxGeometry for the block, with its face colours as vertex colours. */
export function createBlockGeometry(id: BlockId): THREE.BoxGeometry {
  const def = BLOCKS[id];
  const [sx, sy, sz] = def.size ?? [1, 1, 1];
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  // Blocks sit on the ground: shift so y=0 is the bottom face.
  geometry.translate(0, sy / 2, 0);
  const colors = new Float32Array(24 * 3);
  const tmp = new THREE.Color();
  BOX_FACE_ORDER.forEach((face, i) => {
    tmp.setHex(faceColor(def, face));
    // Vertex colours are read as linear; convert from the sRGB hex.
    tmp.convertSRGBToLinear();
    for (let v = 0; v < 4; v++) {
      const o = (i * 4 + v) * 3;
      colors[o] = tmp.r;
      colors[o + 1] = tmp.g;
      colors[o + 2] = tmp.b;
    }
  });
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function createBlockMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}
