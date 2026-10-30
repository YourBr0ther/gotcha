/**
 * Texture loading for Bedrock models. Browser only: it needs a canvas.
 * Kept apart from geometry.ts so the loader math stays testable in node.
 *
 * Images come through `bedrock/prefetch.ts`, which the bundle loader starts
 * the moment the manifest names the files, so by the time the creature is
 * built the bytes are usually decoded already. The decoded image is drawn
 * onto a canvas and uploaded from there; a canvas honours three's default
 * `flipY`, which an ImageBitmap would not.
 */

import * as THREE from "three";
import { prefetchImage, takePrefetchedImage, type PrefetchedImage } from "./prefetch";

export function configureBedrockTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function toCanvas(image: PrefetchedImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  if ("close" in image) image.close();
  return canvas;
}

/** The decoded image for a URL: the prefetched one when the bundle loader started it, else fetched now. */
async function imageFor(url: string): Promise<PrefetchedImage> {
  const prefetched = takePrefetchedImage(url);
  if (prefetched) {
    try {
      return await prefetched;
    } catch {
      // Fall through to a fresh attempt.
    }
  }
  return prefetchImage(url).finally(() => takePrefetchedImage(url));
}

export async function loadBedrockTexture(url: string): Promise<THREE.Texture> {
  const image = await imageFor(url);
  return configureBedrockTexture(new THREE.CanvasTexture(toCanvas(image)));
}

/**
 * Multiply a glow layer's colour by its alpha. Cobblemon's emissive layers
 * are mostly transparent, and an emissiveMap ignores alpha, so without this
 * every clear texel would glow whatever colour the artist left under it.
 */
export function premultiplyAlpha(image: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    px[i] = Math.round(px[i] * a);
    px[i + 1] = Math.round(px[i + 1] * a);
    px[i + 2] = Math.round(px[i + 2] * a);
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export async function loadEmissiveTexture(url: string): Promise<THREE.Texture> {
  const image = await imageFor(url);
  const canvas = premultiplyAlpha(image);
  if ("close" in image) image.close();
  return configureBedrockTexture(new THREE.CanvasTexture(canvas));
}

export function createBedrockMaterial(map: THREE.Texture | null, emissiveMap: THREE.Texture | null = null): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    color: map ? 0xffffff : 0xff00ff,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
  if (map) material.map = map;
  if (emissiveMap) {
    material.emissiveMap = emissiveMap;
    material.emissive.setHex(0xffffff);
    material.emissiveIntensity = 1;
  }
  return material;
}
