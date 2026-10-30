import { describe, expect, it } from "vitest";
import * as THREE from "three";
import cubeGeo from "../fixtures/cube.geo.json";
import { BOX_FACE_ORDER, buildModel } from "./geometry";
import { mergeBoneCubes } from "./merge";
import type { BedrockGeometryFile } from "./types";

const file = cubeGeo as unknown as BedrockGeometryFile;

function countMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) n++;
  });
  return n;
}

describe("mergeBoneCubes", () => {
  it("leaves one mesh per bone with cubes, bones as groups, locators in place", () => {
    const model = buildModel(file, new THREE.MeshBasicMaterial());
    const before = countMeshes(model.root);
    const bonesWithCubes = [...model.bones.values()].filter((b) => b.children.some((c) => c instanceof THREE.Mesh || c instanceof THREE.Group && !c.name)).length;
    expect(before).toBeGreaterThan(bonesWithCubes);
    const meshes = mergeBoneCubes(model);
    expect(meshes).toBe(bonesWithCubes);
    expect(countMeshes(model.root)).toBe(meshes);
    for (const bone of model.bones.values()) {
      expect(bone).toBeInstanceOf(THREE.Group);
      const own = bone.children.filter((c) => c instanceof THREE.Mesh);
      expect(own.length).toBeLessThanOrEqual(1);
    }
    expect(model.bones.get("head")!.getObjectByName("locator:emote")).toBeDefined();
  });

  it("keeps the world-space bounds and the per-face UVs", () => {
    const plain = buildModel(file, new THREE.MeshBasicMaterial());
    const merged = buildModel(file, new THREE.MeshBasicMaterial());
    mergeBoneCubes(merged);
    merged.root.updateMatrixWorld(true);
    const a = new THREE.Box3().setFromObject(plain.root);
    const b = new THREE.Box3().setFromObject(merged.root);
    expect(b.min.toArray().map((v) => +v.toFixed(4))).toEqual(a.min.toArray().map((v) => +v.toFixed(4)));
    expect(b.max.toArray().map((v) => +v.toFixed(4))).toEqual(a.max.toArray().map((v) => +v.toFixed(4)));

    // The body's first cube is first in the merged buffer, so its north face UV is at the same index.
    const first = plain.bones.get("body")!.children[0] as THREE.Mesh;
    const mergedMesh = merged.bones.get("body")!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
    const i = BOX_FACE_ORDER.indexOf("north") * 4;
    const uvA = first.geometry.getAttribute("uv");
    const uvB = mergedMesh.geometry.getAttribute("uv");
    expect(uvB.getX(i)).toBeCloseTo(uvA.getX(i));
    expect(uvB.getY(i)).toBeCloseTo(uvA.getY(i));
    expect(mergedMesh.geometry.getAttribute("position").count).toBe(24 * 2);
    expect(mergedMesh.castShadow).toBe(true);
  });
});
