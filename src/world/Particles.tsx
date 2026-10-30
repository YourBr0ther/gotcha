"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mulberry32 } from "./dioramas/build";

const COUNT = 360;
const BOX = { x: -9, w: 19, y: 0, h: 8, z: -15, d: 21 };

/** Falling snow: one Points draw, wrapped inside the camera's wedge. */
export function Snow() {
  const points = useRef<THREE.Points>(null);
  const { positions, drift } = useMemo(() => {
    const rand = mulberry32(20261106);
    const positions = new Float32Array(COUNT * 3);
    const drift = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = BOX.x + rand() * BOX.w;
      positions[i * 3 + 1] = BOX.y + rand() * BOX.h;
      positions[i * 3 + 2] = BOX.z + rand() * BOX.d;
      drift[i] = rand() * Math.PI * 2;
    }
    return { positions, drift };
  }, []);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime;
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      let y = attr.getY(i) - dt * (0.9 + 0.3 * Math.sin(drift[i]));
      let x = attr.getX(i) + dt * 0.25 * Math.sin(t * 0.8 + drift[i]);
      if (y < BOX.y) {
        y = BOX.y + BOX.h;
        x = BOX.x + ((x - BOX.x + 7.3) % BOX.w);
      }
      if (x < BOX.x) x += BOX.w;
      if (x > BOX.x + BOX.w) x -= BOX.w;
      attr.setXY(i, x, y);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial color={0xffffff} size={0.09} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}
