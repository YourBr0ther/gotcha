import { describe, expect, it } from "vitest";
import cubeGeo from "../fixtures/cube.geo.json";
import { faceRect, faceSprite, findHeadBones, northFaceRect } from "./face";
import type { BedrockGeometryFile } from "./types";

const file = cubeGeo as unknown as BedrockGeometryFile;

describe("faceSprite", () => {
  it("finds the synthetic cube's face on the north side of its head", () => {
    expect(faceRect(file)).toEqual({ x: 32, y: 16, width: 6, height: 6, textureWidth: 64, textureHeight: 32 });
  });

  it("carries the bundle's texture URL along with the rect", () => {
    const sprite = faceSprite({ geometry: file, textures: { base: "/api/assets/cube/textures/cube.png?v=abc" } });
    expect(sprite?.url).toBe("/api/assets/cube/textures/cube.png?v=abc");
    expect(sprite?.width).toBe(6);
  });

  it("reads a box-UV head from the net: north sits one depth right of and below the origin", () => {
    expect(northFaceRect({ origin: [0, 0, 0], size: [8, 8, 8], uv: [0, 0] })).toEqual({ x: 8, y: 8, width: 8, height: 8 });
  });

  it("skips a flat cube and a cube with no north face", () => {
    expect(northFaceRect({ size: [0, 4, 4], uv: [0, 0] })).toBeUndefined();
    expect(northFaceRect({ size: [4, 4, 4], uv: { south: { uv: [0, 0], uv_size: [4, 4] } } })).toBeUndefined();
  });

  it("takes the biggest cube across every head-named bone, like Eevee's empty head over head_angle", () => {
    const bones = [
      { name: "head", pivot: [0, 0, 0] as [number, number, number] },
      { name: "head_angle", parent: "head", cubes: [{ origin: [-3.5, 9.5, -6.5] as [number, number, number], size: [7, 7, 7] as [number, number, number], uv: [0, 0] as [number, number] }] },
      { name: "headband", cubes: [{ size: [2, 1, 1] as [number, number, number], uv: [40, 40] as [number, number] }] },
    ];
    expect(findHeadBones(bones).map((b) => b.name)).toEqual(["head", "head_angle", "headband"]);
    const eevee = { ...file, "minecraft:geometry": [{ ...file["minecraft:geometry"][0], bones }] } as BedrockGeometryFile;
    expect(faceRect(eevee)).toMatchObject({ x: 7, y: 7, width: 7, height: 7 });
  });

  it("returns undefined for a model with no head bone", () => {
    const headless = { ...file, "minecraft:geometry": [{ ...file["minecraft:geometry"][0], bones: [{ name: "body", cubes: [{ size: [4, 4, 4], uv: [0, 0] }] }] }] } as BedrockGeometryFile;
    expect(faceRect(headless)).toBeUndefined();
  });
});
