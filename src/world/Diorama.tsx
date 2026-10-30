"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Backdrop } from "./Backdrop";
import { BLOCK_IDS, BLOCKS, createBlockGeometry, createBlockMaterial, createEmissiveBlockMaterial, type BlockId } from "./blocks/palette";
import { getDiorama } from "./dioramas";
import type { DioramaDef } from "./dioramas/types";
import { Snow } from "./Particles";
import { useWorldState } from "./WorldContext";

interface Built {
  group: THREE.Group;
  dispose(): void;
}

function buildInstances(def: DioramaDef, material: THREE.Material, emissive: THREE.Material): Built {
  const group = new THREE.Group();
  group.name = `diorama:${def.id}`;
  const geometries: THREE.BufferGeometry[] = [];
  const byBlock = new Map<BlockId, typeof def.blocks>();
  for (const b of def.blocks) {
    const list = byBlock.get(b.block) ?? [];
    list.push(b);
    byBlock.set(b.block, list);
  }
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  for (const id of BLOCK_IDS) {
    const list = byBlock.get(id);
    if (!list?.length) continue;
    const geometry = createBlockGeometry(id);
    geometries.push(geometry);
    const block = BLOCKS[id];
    const mesh = new THREE.InstancedMesh(geometry, block.emissive ? emissive : material, list.length);
    mesh.name = `blocks:${id}`;
    mesh.castShadow = !!block.castShadow;
    mesh.receiveShadow = !!block.receiveShadow;
    const full = !block.size;
    list.forEach((b, i) => {
      pos.set(full ? b.x + 0.5 : b.x, b.y, full ? b.z + 0.5 : b.z);
      quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.rotationY ?? 0);
      matrix.compose(pos, quat, one);
      mesh.setMatrixAt(i, matrix);
      color.setHex(b.tint ?? 0xffffff);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}

export function Diorama() {
  const { diorama, depth } = useWorldState();
  const def = getDiorama(diorama);
  const material = useMemo(() => createBlockMaterial(), []);
  const emissive = useMemo(() => createEmissiveBlockMaterial(), []);
  const built = useMemo(() => buildInstances(def, material, emissive), [def, material, emissive]);

  useEffect(() => () => built.dispose(), [built]);
  useEffect(
    () => () => {
      material.dispose();
      emissive.dispose();
    },
    [material, emissive],
  );

  return (
    <group key={def.id}>
      <primitive object={built.group} />
      {def.water.map((w, i) => (
        <mesh key={i} position={[w.x + w.w / 2, w.y, w.z + w.d / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w.w, w.d]} />
          <meshLambertMaterial color={def.lights.sky !== undefined ? 0x2f6fb0 : 0x3f8fe0} transparent opacity={0.72} />
        </mesh>
      ))}
      {def.lights.points?.map((p, i) => (
        <pointLight key={i} position={[p.x, p.y, p.z]} color={p.color} intensity={p.intensity} distance={p.distance} decay={2} />
      ))}
      {depth && <Backdrop def={def.backdrop} />}
      {depth && def.particles === "snow" && <Snow />}
    </group>
  );
}
