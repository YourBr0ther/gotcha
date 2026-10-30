"use client";

import { useEffect, useMemo, useRef } from "react";
import type React from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mulberry32 } from "./dioramas/build";
import type { Falls as FallsDef, WaterVolume } from "./dioramas/types";
import { useWorldStore } from "./WorldContext";

const SHALLOW = new THREE.Color(0x4fa8d8);
const DEEP = new THREE.Color(0x1d5a9a);

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/**
 * Two scrolling pixel-cell patterns stand in for normal maps: one gives the
 * ripple that tilts the normal for the sun's highlight, the other the
 * sparkle. The bank distance comes from the uv against the volume's size,
 * which is enough for a box of water: a foam line along the edge, a
 * shallow tint near it and a darker body in the middle.
 */
const SURFACE_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec2 uSize;
varying vec3 vWorld;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vWorld.xz;
  float n1 = hash(floor((p + vec2(uTime * 0.16, uTime * 0.05)) * 5.0));
  float n2 = hash(floor((p * 1.31 + vec2(-uTime * 0.11, uTime * 0.14)) * 5.0));
  float ripple = n1 * 0.55 + n2 * 0.45;
  vec3 n = normalize(vec3((n1 - 0.5) * 0.45, 1.0, (n2 - 0.5) * 0.45));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 h = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, h), 0.0), 40.0);
  float fresnel = pow(1.0 - max(viewDir.y, 0.0), 3.0);
  vec2 d = min(vUv, 1.0 - vUv) * uSize;
  float bank = min(d.x, d.y);
  float body = smoothstep(0.25, 2.2, bank);
  vec3 color = mix(uShallow, uDeep, body) * uAmbient * (0.8 + 0.35 * ripple);
  float foam = (1.0 - smoothstep(0.08, 0.42, bank)) * step(0.4, fract(n1 * 2.0 + uTime * 0.35));
  float sparkle = step(0.86, ripple);
  color = mix(color, vec3(0.96, 0.99, 1.0) * uAmbient, foam * 0.85 + sparkle * 0.2);
  color += uSunColor * spec * 1.4;
  float alpha = mix(0.58, 0.9, body) + fresnel * 0.08;
  alpha = max(alpha, foam * 0.92);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Streaks scroll down the sheet; the lip at the top is sheer, the base goes white. */
const FALLS_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uShallow;
varying vec3 vWorld;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float y = vWorld.y + uTime * 2.4;
  float s1 = hash(floor(vec2(vWorld.x * 6.0, y * 2.5)));
  float s2 = hash(floor(vec2(vWorld.x * 10.0 + 3.0, (vWorld.y + uTime * 3.1) * 4.0)));
  float streak = smoothstep(0.3, 0.75, s1 * 0.6 + s2 * 0.4);
  float base = 1.0 - smoothstep(0.0, 0.35, vUv.y);
  vec3 color = mix(uShallow * 0.85, vec3(0.95, 0.98, 1.0), streak * 0.8 + base * 0.6) * uAmbient;
  color += uSunColor * 0.12 * streak;
  float alpha = 0.62 + 0.3 * streak + base * 0.2;
  alpha *= smoothstep(1.0, 0.92, vUv.y);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function createUniforms(size: THREE.Vector2) {
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uAmbient: { value: new THREE.Color(0xffffff) },
      uShallow: { value: SHALLOW.clone() },
      uDeep: { value: DEEP.clone() },
      uSize: { value: size },
    },
  ]);
}

/** Push the clock and the light rig into a water material each frame. */
function useLiveWater(): React.RefObject<THREE.Mesh | null> {
  const store = useWorldStore();
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const material = mesh.current?.material as THREE.ShaderMaterial | undefined;
    if (!material) return;
    const u = material.uniforms;
    const l = store.lighting;
    u.uTime.value = state.clock.elapsedTime;
    (u.uSunDir.value as THREE.Vector3).copy(l.sunDir);
    (u.uSunColor.value as THREE.Color).copy(l.sunColor).multiplyScalar(Math.min(1.2, l.sunIntensity * 0.45));
    (u.uAmbient.value as THREE.Color).copy(l.ambient).multiplyScalar(1.25);
  });
  return mesh;
}

/** The surface of one water volume. Transparent, so the floor blocks show through tinted. */
export function Water({ volume }: { volume: WaterVolume }) {
  const mesh = useLiveWater();
  const uniforms = useMemo(() => createUniforms(new THREE.Vector2(volume.w, volume.d)), [volume]);
  return (
    <mesh ref={mesh} position={[volume.x + volume.w / 2, volume.y, volume.z + volume.d / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[volume.w, volume.d]} />
      <shaderMaterial vertexShader={VERTEX} fragmentShader={SURFACE_FRAGMENT} uniforms={uniforms} transparent depthWrite={false} fog />
    </mesh>
  );
}

const SPRAY_COUNT = 48;

/** A sheet down a cliff face and a handful of spray sprites at its foot. */
export function Falls({ def }: { def: FallsDef }) {
  const mesh = useLiveWater();
  const uniforms = useMemo(() => createUniforms(new THREE.Vector2(def.w, def.top - def.bottom)), [def]);
  const height = def.top - def.bottom;
  const { geometry, seeds } = useMemo(() => {
    const rand = mulberry32(def.x * 31 + def.z * 17 + 7);
    const positions = new Float32Array(SPRAY_COUNT * 3);
    const seeds = new Float32Array(SPRAY_COUNT * 2);
    for (let i = 0; i < SPRAY_COUNT; i++) {
      seeds[i * 2] = rand();
      seeds[i * 2 + 1] = rand() * Math.PI * 2;
      positions[i * 3] = def.x + rand() * def.w;
      positions[i * 3 + 1] = def.bottom + rand() * 0.6;
      positions[i * 3 + 2] = def.z + 0.1 + rand() * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { geometry: g, seeds };
  }, [def]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const points = useRef<THREE.Points>(null);

  useFrame((state) => {
    const attr = points.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < SPRAY_COUNT; i++) {
      const phase = (t * (0.6 + seeds[i * 2] * 0.5) + seeds[i * 2 + 1]) % 1.5;
      // Each drop arcs up and out from the foot of the fall, then starts again.
      attr.setY(i, def.bottom + 0.05 + phase * 0.9 - phase * phase * 0.6);
      attr.setZ(i, def.z + 0.1 + phase * (0.3 + seeds[i * 2] * 0.5));
    }
    attr.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={mesh} position={[def.x + def.w / 2, def.bottom + height / 2, def.z + 0.03]} renderOrder={3}>
        <planeGeometry args={[def.w, height]} />
        <shaderMaterial vertexShader={VERTEX} fragmentShader={FALLS_FRAGMENT} uniforms={uniforms} transparent depthWrite={false} fog />
      </mesh>
      <points ref={points} geometry={geometry} frustumCulled={false} renderOrder={4}>
        <pointsMaterial color={0xf2f8ff} size={0.14} sizeAttenuation transparent opacity={0.8} depthWrite={false} />
      </points>
    </group>
  );
}
