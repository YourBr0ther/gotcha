"use client";

import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getDiorama } from "./dioramas";
import type { LightRig } from "./dioramas/types";
import { useWorldStore } from "./WorldContext";

interface Key {
  hour: number;
  sky: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
}

/** The rig's look at a handful of hours; everything between is a blend. */
const KEYS: Key[] = [
  { hour: 0, sky: 0x0b1026, fog: 0x0e1430, sun: 0x8fa3d9, sunIntensity: 0.35, hemiSky: 0x1d2a52, hemiGround: 0x0b0d14, hemiIntensity: 0.45 },
  { hour: 4.5, sky: 0x0b1026, fog: 0x0e1430, sun: 0x8fa3d9, sunIntensity: 0.35, hemiSky: 0x1d2a52, hemiGround: 0x0b0d14, hemiIntensity: 0.45 },
  { hour: 6.5, sky: 0xffa36b, fog: 0xffc39a, sun: 0xffb36a, sunIntensity: 1.3, hemiSky: 0xffc9a0, hemiGround: 0x4a3a2c, hemiIntensity: 0.7 },
  { hour: 9, sky: 0x8fd0ff, fog: 0xbfe3ff, sun: 0xfff3d6, sunIntensity: 2.4, hemiSky: 0xc6e8ff, hemiGround: 0x6d8f3c, hemiIntensity: 1.0 },
  { hour: 16, sky: 0x86ccff, fog: 0xbde0ff, sun: 0xffeec4, sunIntensity: 2.2, hemiSky: 0xc0e4ff, hemiGround: 0x6d8f3c, hemiIntensity: 1.0 },
  { hour: 19, sky: 0xff8c5a, fog: 0xffb089, sun: 0xff9a5a, sunIntensity: 1.1, hemiSky: 0xffb48a, hemiGround: 0x3f3028, hemiIntensity: 0.65 },
  { hour: 21, sky: 0x0b1026, fog: 0x0e1430, sun: 0x8fa3d9, sunIntensity: 0.35, hemiSky: 0x1d2a52, hemiGround: 0x0b0d14, hemiIntensity: 0.45 },
  { hour: 24, sky: 0x0b1026, fog: 0x0e1430, sun: 0x8fa3d9, sunIntensity: 0.35, hemiSky: 0x1d2a52, hemiGround: 0x0b0d14, hemiIntensity: 0.45 },
];

const SHADOW_HALF = 16;

export const DEFAULT_RIG: LightRig = { sun: 1, hemi: 1, fogNear: 14, fogFar: 36 };

/** 0 at night, 1 in full day, smooth through dawn and dusk. */
export function daylight(hours: number): number {
  const up = THREE.MathUtils.smoothstep(hours, 5, 8);
  const down = 1 - THREE.MathUtils.smoothstep(hours, 17.5, 20.5);
  return Math.min(up, down);
}

interface Scratch {
  b: THREE.Color;
  sky: THREE.Color;
  fog: THREE.Fog;
  applied: number;
  appliedRig: LightRig | null;
}

/** Interpolate the keys for an hour, scale by the scene's rig, and write to the scene and lights. */
export function applyTimeOfDay(
  hours: number,
  scene: THREE.Scene,
  sun: THREE.DirectionalLight | null,
  hemi: THREE.HemisphereLight | null,
  s: Scratch,
  rig: LightRig = DEFAULT_RIG,
): void {
  if (hours === s.applied && rig === s.appliedRig) return;
  s.applied = hours;
  s.appliedRig = rig;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= hours) i++;
  const k0 = KEYS[i];
  const k1 = KEYS[i + 1];
  const span = k1.hour - k0.hour;
  const t = span > 0 ? THREE.MathUtils.clamp((hours - k0.hour) / span, 0, 1) : 0;
  const smooth = t * t * (3 - 2 * t);

  if (rig.sky !== undefined) s.sky.setHex(rig.sky);
  else s.sky.setHex(k0.sky).lerp(s.b.setHex(k1.sky), smooth);
  scene.background = s.sky;
  if (rig.fog !== undefined) s.fog.color.setHex(rig.fog);
  else s.fog.color.setHex(k0.fog).lerp(s.b.setHex(k1.fog), smooth);
  s.fog.near = rig.fogNear;
  s.fog.far = rig.fogFar;
  scene.fog = s.fog;

  if (sun) {
    sun.color.setHex(k0.sun).lerp(s.b.setHex(k1.sun), smooth);
    sun.intensity = THREE.MathUtils.lerp(k0.sunIntensity, k1.sunIntensity, smooth) * rig.sun;
    // Sun arcs from east at 6 to west at 18; at night the moon takes a low mirrored path.
    const angle = ((hours - 6) / 12) * Math.PI;
    let y = Math.sin(angle);
    let x = -Math.cos(angle);
    if (y < 0.08) {
      y = 0.35;
      x = -x * 0.6;
    }
    sun.position.set(x * 18 + 2, y * 18 + 4, 4);
    sun.target.position.set(0, 0, -6);
    sun.target.updateMatrixWorld();
  }
  if (hemi) {
    hemi.color.setHex(k0.hemiSky).lerp(s.b.setHex(k1.hemiSky), smooth);
    hemi.groundColor.setHex(k0.hemiGround).lerp(s.b.setHex(k1.hemiGround), smooth);
    hemi.intensity = THREE.MathUtils.lerp(k0.hemiIntensity, k1.hemiIntensity, smooth) * rig.hemi;
  }
}

export function DayNight() {
  const store = useWorldStore();
  const scene = useThree((s) => s.scene);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const [scratch] = useState<Scratch>(() => ({
    b: new THREE.Color(),
    sky: new THREE.Color(),
    fog: new THREE.Fog(0x000000, 14, 36),
    applied: -1,
    appliedRig: null,
  }));

  useFrame(() => {
    applyTimeOfDay(store.state.timeOfDay, scene, sun.current, hemi.current, scratch, getDiorama(store.state.diorama).lights);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={[0xc6e8ff, 0x6d8f3c, 1]} />
      <directionalLight
        ref={sun}
        castShadow
        position={[6, 14, 6]}
        intensity={2.4}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />
    </>
  );
}
