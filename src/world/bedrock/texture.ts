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

export function createBedrockMaterial(map: THREE.Texture | null): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: map ?? undefined,
    color: map ? 0xffffff : 0xff00ff,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
}
