"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getDiorama } from "./dioramas";
import type { LightRig } from "./dioramas/types";
import { lightingAt, type Lighting } from "./lighting";
import { useWorldStore } from "./WorldContext";

export { DEFAULT_RIG, daylight } from "./lighting";

/** The sun shadow map covers this much either side of the scene's centre, in light space. */
const SHADOW_HALF = 17;
const SUN_TARGET = new THREE.Vector3(0.5, 0, -8);
const SUN_DISTANCE = 36;
const SKY_RADIUS = 70;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uDisc;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  // A hot disc the bloom can pick up, and a soft halo around it.
  c += uSunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.35) * uDisc;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Scratch {
  fog: THREE.Fog;
  applied: number;
  rig: LightRig | null;
}

/** Interpolate the rig for an hour and write it to the scene, the lights, the sky and the exposure. */
export function applyLighting(
  hours: number,
  rig: LightRig,
  light: Lighting,
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight | null,
  hemi: THREE.HemisphereLight | null,
  fill: THREE.DirectionalLight | null,
  sky: THREE.ShaderMaterial | null,
  s: Scratch,
): void {
  if (hours === s.applied && rig === s.rig) return;
  s.applied = hours;
  s.rig = rig;
  lightingAt(hours, light, rig);

  scene.background = null;
  s.fog.color.copy(light.fog);
  s.fog.near = light.fogNear;
  s.fog.far = light.fogFar;
  scene.fog = s.fog;
  gl.toneMappingExposure = light.exposure;

  if (sun) {
    sun.color.copy(light.sunColor);
    sun.intensity = light.sunIntensity;
    sun.position.copy(SUN_TARGET).addScaledVector(light.sunDir, SUN_DISTANCE);
    sun.target.position.copy(SUN_TARGET);
    sun.target.updateMatrixWorld();
  }
  if (hemi) {
    hemi.color.copy(light.hemiSky);
    hemi.groundColor.copy(light.hemiGround);
    hemi.intensity = light.hemiIntensity;
  }
  if (fill) {
    fill.color.copy(light.hemiSky).lerp(light.sunColor, 0.4);
    fill.intensity = light.fillIntensity;
  }
  if (sky) {
    const u = sky.uniforms;
    (u.uTop.value as THREE.Color).copy(light.skyTop);
    (u.uHorizon.value as THREE.Color).copy(light.skyHorizon);
    (u.uSunDir.value as THREE.Vector3).copy(light.sunDir);
    (u.uSunColor.value as THREE.Color).copy(light.sunColor);
    u.uDisc.value = light.disc;
  }
}

export function DayNight() {
  const store = useWorldStore();
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const [scratch] = useState<Scratch>(() => ({ fog: new THREE.Fog(0x000000, 20, 60), applied: -1, rig: null }));
  const skyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: {
          uTop: { value: new THREE.Color(0x3b86e0) },
          uHorizon: { value: new THREE.Color(0xbfe0ff) },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color(0xffffff) },
          uDisc: { value: 1 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );

  useFrame(() => {
    applyLighting(store.state.timeOfDay, getDiorama(store.state.diorama).lights, store.lighting, scene, gl, sun.current, hemi.current, fill.current, skyMaterial, scratch);
  });

  return (
    <>
      <mesh material={skyMaterial} frustumCulled={false} renderOrder={-10}>
        <sphereGeometry args={[SKY_RADIUS, 24, 12]} />
      </mesh>
      <hemisphereLight ref={hemi} args={[0xcbe4ff, 0x6b8743, 0.85]} />
      <directionalLight
        ref={sun}
        castShadow
        position={[6, 24, 14]}
        intensity={3}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.035}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-camera-near={2}
        shadow-camera-far={SUN_DISTANCE + 30}
      />
      {/* A weak fill from the camera side keeps the faces turned to us from going flat black. */}
      <directionalLight ref={fill} position={[0.5, 5, 26]} intensity={0.3} />
    </>
  );
}
