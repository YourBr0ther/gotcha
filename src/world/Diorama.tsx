"use client";

import { useEffect, useMemo } from "react";
import { Backdrop } from "./Backdrop";
import { buildVoxelGeometry } from "./blocks/mesher";
import { createBlockMaterial, createEmissiveBlockMaterial } from "./blocks/palette";
import { getDiorama } from "./dioramas";
import { Snow } from "./Particles";
import { Tufts } from "./Tufts";
import { Falls, Water } from "./Water";
import { useWorldState } from "./WorldContext";

/**
 * One diorama: every block merged into a lit mesh and an emissive mesh with
 * ambient occlusion in their vertex colours, the water surfaces and falls,
 * the grass tufts, any always-on lights, and behind it all the painted wall.
 */
export function Diorama() {
  const { diorama, depth } = useWorldState();
  const def = getDiorama(diorama);
  const material = useMemo(() => createBlockMaterial(), []);
  const emissive = useMemo(() => createEmissiveBlockMaterial(), []);
  const built = useMemo(
    () =>
      buildVoxelGeometry(def.blocks, {
        minX: def.nav.originX,
        maxX: def.nav.originX + def.nav.width - 1,
        minZ: def.nav.originZ,
        maxZ: def.nav.originZ + def.nav.depth - 1,
      }),
    [def],
  );

  useEffect(
    () => () => {
      built.lit.dispose();
      built.emissive?.dispose();
    },
    [built],
  );
  useEffect(
    () => () => {
      material.dispose();
      emissive.dispose();
    },
    [material, emissive],
  );

  return (
    <group key={def.id}>
      <mesh geometry={built.lit} material={material} castShadow receiveShadow />
      {built.emissive && <mesh geometry={built.emissive} material={emissive} />}
      {def.water.map((w, i) => (
        <Water key={i} volume={w} />
      ))}
      {def.falls.map((f, i) => (
        <Falls key={i} def={f} />
      ))}
      <Tufts def={def} />
      {def.lights.points?.map((p, i) => (
        <pointLight key={i} position={[p.x, p.y, p.z]} color={p.color} intensity={p.intensity} distance={p.distance} decay={2} />
      ))}
      {depth && <Backdrop def={def.backdrop} />}
      {depth && def.particles === "snow" && <Snow />}
    </group>
  );
}
