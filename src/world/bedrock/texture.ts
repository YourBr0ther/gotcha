/**
 * Texture loading for Bedrock models. Browser only: it needs an Image.
 * Kept apart from geometry.ts so the loader math stays testable in node.
 */

import * as THREE from "three";

export function configureBedrockTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function loadBedrockTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => resolve(configureBedrockTexture(texture)),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(`Failed to load texture ${url}`)),
    );
  });
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
  const source = await loadBedrockTexture(url);
  const image = source.image as HTMLImageElement;
  const texture = new THREE.CanvasTexture(premultiplyAlpha(image));
  source.dispose();
  return configureBedrockTexture(texture);
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
