"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { exposedTops } from "./blocks/mesher";
import { hashCell, topColorAt } from "./blocks/palette";
import type { DioramaDef } from "./dioramas/types";

/** The subject's cell; tufts are dense around it and thin out toward the back. */
const NEAR = { x: 0.5, z: 1.5 };

/** A 16x16 pixel-art alpha mask of a few blades, drawn once per page. */
function bladeTexture(): THREE.Texture {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  const blades: Array<[number, number, number]> = [
    [2, 9, 1],
    [4, 14, 2],
    [7, 16, 2],
    [10, 13, 2],
    [13, 10, 1],
    [1, 6, 1],
    [15, 7, 1],
  ];
  for (const [x, h, w] of blades) {
    for (let y = 0; y < h; y++) {
      // Blades taper: the top rows are one pixel wide and lean a little.
      const lean = Math.floor((y / h) * 1.5);
      const width = y > h * 0.6 ? 1 : w;
      ctx.fillRect(x + lean, size - 1 - y, width, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Two crossed quads, bottom at y=0, with a darker foot baked into vertex colours. */
function crossGeometry(): THREE.BufferGeometry {
  const w = 0.6;
  const h = 0.3;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number) => {
    const base = positions.length / 3;
    positions.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    colors.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1, 1, 1, 1, 1, 1);
    // Lit like the lawn under them, not like a wall: every blade faces up.
    for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(-w / 2, 0, w / 2, 0);
  quad(0, -w / 2, 0, w / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Where tufts stand: more per cell near the subject, a few far back, none under a tree. */
export function placeTufts(def: DioramaDef): Placement[] {
  const out: Placement[] = [];
  for (const top of exposedTops(def.blocks, "grass")) {
    const dz = top.z - NEAR.z;
    const dx = top.x - NEAR.x;
    const dist = Math.sqrt(dx * dx + dz * dz * 0.6);
    // Cells between the camera and the subject stay thin and low so blades
    // never fill the lens; the lawn around the subject is the dense part.
    const front = top.z > NEAR.z + 0.5;
    const want = front ? (hashCell(top.x, top.z, 9) < 0.5 ? 1 : 0) : dist < 7 ? 2 : dist < 13 ? 1 : hashCell(top.x, top.z, 9) < 0.4 ? 1 : 0;
    for (let i = 0; i < want; i++) {
      out.push({
        x: top.x + 0.15 + hashCell(top.x, top.z, 10 + i) * 0.7,
        y: top.y,
        z: top.z + 0.15 + hashCell(top.x, top.z, 20 + i) * 0.7,
        yaw: hashCell(top.x, top.z, 30 + i) * Math.PI,
        scale: (front ? 0.55 : 0.8) + hashCell(top.x, top.z, 40 + i) * 0.4,
      });
    }
  }
  return out;
}

/** Instanced cross-plane grass with a gentle sway, one draw call for the whole lawn. */
export function Tufts({ def }: { def: DioramaDef }) {
  const placements = useMemo(() => placeTufts(def), [def]);
  const texture = useMemo(() => bladeTexture(), []);
  const geometry = useMemo(() => crossGeometry(), []);
  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ alphaMap: texture, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    // The sway clock lives on the material so the frame loop can reach it through the mesh.
    const uTime = { value: 0 };
    m.userData.uTime = uTime;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
          vec3 tuftOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
          vec3 tuftOrigin = vec3(0.0);
          #endif
          float sway = sin(uTime * 1.4 + tuftOrigin.x * 1.7 + tuftOrigin.z * 1.3) * 0.06 + sin(uTime * 2.3 + tuftOrigin.z * 2.1) * 0.03;
          transformed.x += sway * uv.y;
          transformed.z += sway * 0.5 * uv.y;`,
        );
    };
    return m;
  }, [texture]);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    placements.forEach((p, i) => {
      pos.set(p.x, p.y, p.z);
      quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      scale.set(p.scale, p.scale, p.scale);
      m.setMatrixAt(i, matrix.compose(pos, quat, scale));
      // The blade colour is the lawn's shade at that cell, a touch brighter so tufts read against it.
      m.setColorAt(i, topColorAt("grass", p.x, p.z, color).multiplyScalar(0.95 + hashCell(Math.floor(p.x), Math.floor(p.z), 50 + i) * 0.25));
    });
    m.count = placements.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }, [geometry, material, placements]);

  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
    [geometry, material, texture],
  );

  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame((state) => {
    const m = ref.current?.material as THREE.MeshLambertMaterial | undefined;
    if (m) (m.userData.uTime as { value: number }).value = state.clock.elapsedTime;
  });

  if (!placements.length) return null;
  return <primitive ref={ref} object={mesh} />;
}
