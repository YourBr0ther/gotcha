/**
 * Collapse each bone's cubes into one mesh so a model costs one draw call
 * per bone that has cubes, not one per cube. Bones stay Groups, so the
 * mixer and the procedural layers see the same hierarchy as before; only
 * the leaves under each bone change. Per-face UVs come through unchanged
 * because the cube geometries are baked, not rebuilt.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LoadedModel } from "./geometry";

interface Leaf {
  mesh: THREE.Mesh;
  /** The cube's transform relative to its bone, including any rotation wrapper. */
  matrix: THREE.Matrix4;
  /** The wrapper to remove, or the mesh itself. */
  node: THREE.Object3D;
}

function cubeLeaves(bone: THREE.Object3D): Leaf[] {
  const leaves: Leaf[] = [];
  for (const child of bone.children) {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      leaves.push({ mesh: child, matrix: child.matrix.clone(), node: child });
      continue;
    }
    // A rotated cube sits under a wrapper Group; locators and child bones do not count.
    if (child.name.startsWith("locator:")) continue;
    if (child instanceof THREE.Group && child.children.length === 1 && child.children[0] instanceof THREE.Mesh && !child.name) {
      const mesh = child.children[0] as THREE.Mesh;
      child.updateMatrix();
      mesh.updateMatrix();
      leaves.push({ mesh, matrix: child.matrix.clone().multiply(mesh.matrix), node: child });
    }
  }
  return leaves;
}

/** Merge in place and return how many meshes remain. */
export function mergeBoneCubes(model: LoadedModel): number {
  let meshes = 0;
  for (const bone of model.bones.values()) {
    const leaves = cubeLeaves(bone);
    if (leaves.length === 0) continue;
    const material = leaves[0].mesh.material;
    const parts = leaves.map((leaf) => {
      const g = leaf.mesh.geometry.clone();
      g.applyMatrix4(leaf.matrix);
      return g;
    });
    const merged = leaves.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (leaves.length > 1) for (const g of parts) g.dispose();
    if (!merged) continue;
    for (const leaf of leaves) {
      bone.remove(leaf.node);
      leaf.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${bone.name}:cubes`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    bone.add(mesh);
    meshes++;
  }
  return meshes;
}
