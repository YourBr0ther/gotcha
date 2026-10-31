/**
 * Packs the sprite sheets a creature's particle effects use into one
 * texture, so every effect of one blend mode draws in a single call.
 * Browser only (it needs a canvas); particles.ts takes the result and runs
 * the same under node with EMPTY_ATLAS.
 *
 * The sheets are tiny (16x96, 8x56, 12x9) so a single column with a one
 * pixel gap is plenty, and nearest filtering plus the gap keeps frames from
 * bleeding into each other. An effect whose texture is missing or fails to
 * load gets a white block, which its tint then colours.
 */

import * as THREE from "three";
import type { ParticleEffectAsset } from "../api";
import type { AtlasRect, ParticleAtlas } from "./particles";
import { prefetchImage, type PrefetchedImage } from "./prefetch";
import { configureBedrockTexture } from "./texture";

const GAP = 1;
const BLANK = 2;

export async function buildParticleAtlas(effects: Record<string, ParticleEffectAsset>): Promise<ParticleAtlas> {
  const urls = [...new Set(Object.values(effects).map((e) => e.texture).filter((u): u is string => !!u))].sort();
  const images = new Map<string, PrefetchedImage | null>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        images.set(url, await prefetchImage(url));
      } catch (err) {
        console.warn(`[world] particle texture failed: ${url}; drawing white`, err);
        images.set(url, null);
      }
    }),
  );

  // Layout: a blank block first, then each image in a column.
  const placed = new Map<string, AtlasRect>();
  let width = BLANK;
  let y = BLANK + GAP;
  const blank: AtlasRect = { x: 0, y: 0, w: BLANK, h: BLANK };
  for (const url of urls) {
    const image = images.get(url);
    if (!image) continue;
    placed.set(url, { x: 0, y, w: image.width, h: image.height });
    width = Math.max(width, image.width);
    y += image.height + GAP;
  }
  const height = y;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(blank.x, blank.y, blank.w, blank.h);
  for (const [url, rect] of placed) {
    const image = images.get(url)!;
    ctx.drawImage(image, rect.x, rect.y);
    if ("close" in image) image.close();
  }

  const rects = new Map<string, AtlasRect>();
  for (const [id, effect] of Object.entries(effects)) {
    rects.set(id, (effect.texture && placed.get(effect.texture)) || blank);
  }
  const texture = configureBedrockTexture(new THREE.CanvasTexture(canvas));
  return { texture, width, height, rects };
}
