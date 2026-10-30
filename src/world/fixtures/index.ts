/**
 * The synthetic placeholder creature: a two-bone Bedrock model with a
 * texture drawn on a canvas at load time, so the fixture needs no binary
 * asset in the repo.
 */

import type { PokemonBundle } from "../api";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "../bedrock/types";
import cubeAnimation from "./cube.animation.json";
import cubeGeometry from "./cube.geo.json";
import cubePoser from "./cube.poser.json";

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 64x32, laid out to match cube.geo.json's UVs. Browser only. */
export function drawCubeTexture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const fur = "#d99a4e";
  const furDark = "#b67a35";
  const belly = "#f4e2b8";
  const eye = "#2a1b12";

  // Body box UV at (0,0), size 6x5x8: sides at v 8..13, up/down at v 0..8.
  rect(ctx, fur, 0, 8, 28, 5); // east, north, west, south strips
  rect(ctx, furDark, 8, 0, 6, 8); // up (back)
  rect(ctx, belly, 14, 0, 6, 8); // down (belly)
  // A stripe on the back and a patch on the east (right) flank.
  rect(ctx, "#8a5a22", 10, 1, 2, 6);
  rect(ctx, belly, 2, 10, 4, 2);

  // Tail box UV at (0,13), size 4x3x3, mirrored.
  rect(ctx, furDark, 0, 13, 14, 6);
  rect(ctx, belly, 7, 13, 4, 3);

  // Legs box UV at (20,13), size 2x3x2.
  rect(ctx, furDark, 20, 13, 8, 5);
  rect(ctx, belly, 22, 13, 2, 2);

  // Head per-face UV: north (32,16) 6x6 with the face.
  rect(ctx, fur, 32, 16, 6, 6);
  rect(ctx, eye, 33, 18, 1, 1);
  rect(ctx, eye, 36, 18, 1, 1);
  rect(ctx, "#ff7a9a", 34, 20, 2, 1);
  // south (38,16) 6x6: back of the head, darker.
  rect(ctx, furDark, 38, 16, 6, 6);
  // east (44,16) 5x6 and west (49,16) 5x6: a cheek mark on the east side only.
  rect(ctx, fur, 44, 16, 5, 6);
  rect(ctx, "#ff7a9a", 45, 19, 2, 1);
  rect(ctx, fur, 49, 16, 5, 6);
  // up (32,22) 6x5 and down (38,22) 6x5.
  rect(ctx, furDark, 32, 22, 6, 5);
  rect(ctx, belly, 38, 22, 6, 5);

  return canvas.toDataURL("image/png");
}

export function createCubeBundle(): PokemonBundle {
  return {
    species: "cube",
    geometry: cubeGeometry as unknown as BedrockGeometryFile,
    animations: cubeAnimation as unknown as BedrockAnimationFile,
    poser: cubePoser as unknown as PoserFile,
    textures: { base: drawCubeTexture() },
    baseScale: 1,
  };
}
