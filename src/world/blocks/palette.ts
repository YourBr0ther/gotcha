/**
 * The flat-colour block palette dioramas are built from. Each block is a
 * unit cube with a colour per face; the mesher in `mesher.ts` bakes those
 * colours, a per-cell variation and ambient occlusion into vertex colours
 * on one merged geometry per diorama. Emissive blocks draw unlit so they
 * read as their own light source.
 */

import * as THREE from "three";
import { BOX_FACE_ORDER } from "../bedrock/geometry";
import type { BedrockFaceName } from "../bedrock/types";

export type BlockId =
  | "grass"
  | "dirt"
  | "podzol"
  | "stone"
  | "stone_dark"
  | "stone_mossy"
  | "gravel"
  | "sand"
  | "sand_wet"
  | "snow"
  | "ice"
  | "log"
  | "log_dark"
  | "log_palm"
  | "leaves"
  | "leaves_light"
  | "leaves_dark"
  | "leaves_spruce"
  | "leaves_palm"
  | "tuft"
  | "fern"
  | "stem"
  | "flower_white"
  | "flower_pink"
  | "flower_yellow"
  | "flower_centre"
  | "mushroom_stem"
  | "mushroom_red"
  | "mushroom_brown"
  | "crystal_cyan"
  | "crystal_violet"
  | "lily_pad"
  | "reed"
  | "shell"
  | "snow_tuft";

export interface BlockDef {
  /** Per-face colour; `side` covers the four sides when a face is not named. */
  colors: { top: number; bottom?: number; side: number } & Partial<Record<BedrockFaceName, number>>;
  /** Size of the block as a fraction of a unit cube. Defaults to a full block. */
  size?: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Drawn unlit at full colour so it glows. */
  emissive?: boolean;
  /** Sides fade from the top colour at their upper edge to the side colour, like grass draping over dirt. */
  sideFade?: boolean;
  /** Two colours the top face drifts between per cell, keyed by position, so a lawn is not one flat green. */
  variation?: [number, number];
}

export const BLOCKS: Record<BlockId, BlockDef> = {
  grass: { colors: { top: 0x69a838, side: 0x8a5f3a, bottom: 0x6f4b2d }, receiveShadow: true, sideFade: true, variation: [0x579630, 0x7fbb44] },
  dirt: { colors: { top: 0x8a5f3a, side: 0x7c5433, bottom: 0x6f4b2d }, receiveShadow: true },
  podzol: { colors: { top: 0x6e5033, side: 0x7c5433, bottom: 0x6f4b2d }, receiveShadow: true, variation: [0x5e4229, 0x7a5a38] },
  stone: { colors: { top: 0x8e8c86, side: 0x7d7b75, bottom: 0x66645f }, castShadow: true, receiveShadow: true, variation: [0x84827c, 0x9a988f] },
  stone_dark: { colors: { top: 0x555962, side: 0x474b54, bottom: 0x383b43 }, castShadow: true, receiveShadow: true },
  stone_mossy: { colors: { top: 0x6a9a4e, side: 0x7f8878, bottom: 0x66645f }, castShadow: true, receiveShadow: true, sideFade: true },
  gravel: { colors: { top: 0x7b7772, side: 0x6c6863, bottom: 0x5c5853 }, receiveShadow: true },
  sand: { colors: { top: 0xe3d3a0, side: 0xd4c38c, bottom: 0xc4b27a }, receiveShadow: true, variation: [0xdccb96, 0xeadcae] },
  sand_wet: { colors: { top: 0xc6b37c, side: 0xb5a36e, bottom: 0xa5935f }, receiveShadow: true },
  snow: { colors: { top: 0xf3f7ff, side: 0xdce5f2, bottom: 0xb6c2d3 }, receiveShadow: true, variation: [0xeef3fc, 0xf8fbff] },
  ice: { colors: { top: 0xa6d9f4, side: 0x8bc3e8, bottom: 0x6ca5d4 }, receiveShadow: true },
  log: { colors: { top: 0xb08a55, bottom: 0xb08a55, side: 0x654427 }, castShadow: true, receiveShadow: true },
  log_dark: { colors: { top: 0x86663f, bottom: 0x86663f, side: 0x46301d }, castShadow: true, receiveShadow: true },
  log_palm: { colors: { top: 0xc49c66, bottom: 0xc49c66, side: 0x946d42 }, castShadow: true, receiveShadow: true },
  leaves: { colors: { top: 0x58a234, side: 0x4a8e2c, bottom: 0x376d22 }, castShadow: true, receiveShadow: true, variation: [0x509a30, 0x62ac3a] },
  leaves_light: { colors: { top: 0x82c848, side: 0x6fb53e, bottom: 0x4a8e2c }, castShadow: true, receiveShadow: true, variation: [0x78c042, 0x8ed052] },
  leaves_dark: { colors: { top: 0x3b7a27, side: 0x336b21, bottom: 0x27521a }, castShadow: true, receiveShadow: true, variation: [0x367223, 0x42842c] },
  leaves_spruce: { colors: { top: 0x2f6b3a, side: 0x265a30, bottom: 0x1c4424 }, castShadow: true, receiveShadow: true, variation: [0x2b6436, 0x357540] },
  leaves_palm: { colors: { top: 0x6ccc4a, side: 0x4fa83a, bottom: 0x3f8f2f }, size: [1, 0.3, 1], castShadow: true, receiveShadow: true },
  tuft: { colors: { top: 0x86c84c, side: 0x6ab540 }, size: [0.55, 0.35, 0.55] },
  fern: { colors: { top: 0x3f9a3a, side: 0x2f7a2c }, size: [0.7, 0.5, 0.7], castShadow: true },
  stem: { colors: { top: 0x4f9a35, side: 0x4f9a35 }, size: [0.12, 0.45, 0.12] },
  // Daisy petals are a thin bar; two crossed make the flower, the centre sits on top.
  flower_white: { colors: { top: 0xfff8ee, side: 0xf0e8d8, bottom: 0xe8dcc4 }, size: [0.5, 0.1, 0.17], castShadow: true },
  flower_pink: { colors: { top: 0xff7fb4, side: 0xee5f98, bottom: 0xd44e84 }, size: [0.5, 0.1, 0.17], castShadow: true },
  flower_yellow: { colors: { top: 0xffd64a, side: 0xf3c43a, bottom: 0xe8a81e }, size: [0.28, 0.2, 0.28], castShadow: true },
  flower_centre: { colors: { top: 0xffd24a, side: 0xf0b83a }, size: [0.18, 0.1, 0.18] },
  mushroom_stem: { colors: { top: 0xf0e6d2, side: 0xe0d4bc }, size: [0.22, 0.45, 0.22] },
  mushroom_red: { colors: { top: 0xe0413a, side: 0xc8332c, bottom: 0xf5ead8 }, size: [0.55, 0.28, 0.55], castShadow: true },
  mushroom_brown: { colors: { top: 0xa0724a, side: 0x8a6040, bottom: 0xf5ead8 }, size: [0.45, 0.24, 0.45], castShadow: true },
  crystal_cyan: { colors: { top: 0xc8fbff, side: 0x66e6ff, bottom: 0x2fb6d6 }, size: [0.45, 1.2, 0.45], emissive: true },
  crystal_violet: { colors: { top: 0xf0d2ff, side: 0xc77dff, bottom: 0x8a3fd6 }, size: [0.4, 0.9, 0.4], emissive: true },
  lily_pad: { colors: { top: 0x4faa3f, side: 0x3f8a32, bottom: 0x2f6a26 }, size: [0.8, 0.06, 0.8] },
  reed: { colors: { top: 0x9ac25a, side: 0x6f9a3a }, size: [0.12, 1.4, 0.12], castShadow: true },
  shell: { colors: { top: 0xffe4ea, side: 0xf2c4cf, bottom: 0xe0a8b6 }, size: [0.3, 0.14, 0.3] },
  snow_tuft: { colors: { top: 0xffffff, side: 0xe8f0fa }, size: [0.5, 0.25, 0.5] },
};

export const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[];

/** A stable number in [0, 1) for a cell, so a block looks the same on every build and every device. */
export function hashCell(x: number, z: number, salt = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(salt | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The top colour of a block at a cell: the face colour, or for a block with
 * `variation` a blend of its two shades keyed by position.
 */
export function topColorAt(id: BlockId, x: number, z: number, out = new THREE.Color()): THREE.Color {
  const def = BLOCKS[id];
  if (!def.variation) return out.setHex(def.colors.top);
  const t = hashCell(Math.floor(x), Math.floor(z), id.length);
  return out.setHex(def.variation[0]).lerp(new THREE.Color(def.variation[1]), t);
}

export function faceColor(def: BlockDef, face: BedrockFaceName): number {
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
    // setHex converts the sRGB hex into the linear working space already.
    tmp.setHex(faceColor(def, face));
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

/** Unlit material for emissive blocks; fog still applies so they sit in the scene. */
export function createEmissiveBlockMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
}
