/**
 * The time-of-day rig as pure numbers: one warm sun (a cool moon at night)
 * whose elevation, azimuth, colour and strength follow the clock, a
 * hemisphere light for sky and ground bounce, a weak fill from the camera
 * side, tone-mapping exposure, and the sky and fog colours. `DayNight`
 * writes these into the scene; water and grass read the same snapshot from
 * the store so every surface agrees on where the light comes from.
 */

import * as THREE from "three";
import type { LightRig } from "./dioramas/types";

export interface Lighting {
  sunColor: THREE.Color;
  sunIntensity: number;
  /** Unit vector from the scene toward the sun. */
  sunDir: THREE.Vector3;
  /** Degrees above the horizon. */
  elevation: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fillIntensity: number;
  exposure: number;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** How bright the disc in the sky draws; 0 hides it. */
  disc: number;
  /** 0 at night, 1 in full day. */
  daylight: number;
  /** Roughly the light landing on an upward face, for unlit shaders. */
  ambient: THREE.Color;
}

export function createLighting(): Lighting {
  return {
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    sunDir: new THREE.Vector3(0, 1, 0),
    elevation: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    fillIntensity: 0,
    exposure: 1,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    fog: new THREE.Color(),
    fogNear: 20,
    fogFar: 60,
    disc: 0,
    daylight: 0,
    ambient: new THREE.Color(),
  };
}

interface Key {
  hour: number;
  sun: number;
  sunIntensity: number;
  elevation: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fill: number;
  exposure: number;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  disc: number;
}

const NIGHT: Omit<Key, "hour"> = {
  sun: 0x8da4e8,
  sunIntensity: 0.85,
  elevation: 44,
  hemiSky: 0x2e4078,
  hemiGround: 0x161a2c,
  hemiIntensity: 0.85,
  fill: 0.12,
  exposure: 0.82,
  skyTop: 0x070c24,
  skyHorizon: 0x1a2a52,
  fog: 0x151d3a,
  disc: 0.5,
};

/** The rig at a handful of hours; everything between is a smooth blend. */
const KEYS: Key[] = [
  { hour: 0, ...NIGHT },
  { hour: 4.5, ...NIGHT },
  { hour: 6, sun: 0xffa05c, sunIntensity: 1.3, elevation: 5, hemiSky: 0xf0b090, hemiGround: 0x4a3a2c, hemiIntensity: 0.55, fill: 0.2, exposure: 0.95, skyTop: 0x5c86cc, skyHorizon: 0xffc48c, fog: 0xf0c6a0, disc: 1 },
  { hour: 8, sun: 0xffd8a0, sunIntensity: 2.7, elevation: 27, hemiSky: 0xbddcff, hemiGround: 0x8a9a50, hemiIntensity: 1.0, fill: 0.45, exposure: 1.05, skyTop: 0x5a9ce8, skyHorizon: 0xd8ecff, fog: 0xcfe3ec, disc: 1 },
  { hour: 12, sun: 0xffefcf, sunIntensity: 2.8, elevation: 64, hemiSky: 0xc4e0ff, hemiGround: 0x849a52, hemiIntensity: 0.95, fill: 0.45, exposure: 1.0, skyTop: 0x3b86e0, skyHorizon: 0xbfe0ff, fog: 0xc0dde6, disc: 1 },
  { hour: 16, sun: 0xffe9c2, sunIntensity: 2.5, elevation: 36, hemiSky: 0xc4e0ff, hemiGround: 0x849a52, hemiIntensity: 0.95, fill: 0.45, exposure: 1.0, skyTop: 0x4a92e4, skyHorizon: 0xcfe6ff, fog: 0xc6dee6, disc: 1 },
  { hour: 18, sun: 0xff9448, sunIntensity: 1.7, elevation: 8, hemiSky: 0xffb07a, hemiGround: 0x4c3a2e, hemiIntensity: 0.6, fill: 0.25, exposure: 0.95, skyTop: 0x4b6cb8, skyHorizon: 0xff9c5c, fog: 0xeea678, disc: 1 },
  { hour: 19.5, sun: 0xa090c8, sunIntensity: 0.8, elevation: 18, hemiSky: 0x50508c, hemiGround: 0x241e2c, hemiIntensity: 0.6, fill: 0.15, exposure: 0.88, skyTop: 0x14214a, skyHorizon: 0x5a4a80, fog: 0x3c3a60, disc: 0.6 },
  { hour: 21, ...NIGHT },
  { hour: 24, ...NIGHT },
];

export const DEFAULT_RIG: LightRig = { sun: 1, hemi: 1, fogNear: 20, fogFar: 60 };

/** 0 at night, 1 in full day, smooth through dawn and dusk. */
export function daylight(hours: number): number {
  const up = THREE.MathUtils.smoothstep(hours, 5, 8);
  const down = 1 - THREE.MathUtils.smoothstep(hours, 17.5, 20.5);
  return Math.min(up, down);
}

const scratch = new THREE.Color();

/**
 * Fill `out` with the rig for an hour. The sun circles from the right at 6
 * to the left at 18 and keeps going through the night as the moon, always
 * leaning a little toward the camera so the faces it sees stay lit.
 */
export function lightingAt(hours: number, out: Lighting, rig: LightRig = DEFAULT_RIG): Lighting {
  const h = ((hours % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= h) i++;
  const k0 = KEYS[i];
  const k1 = KEYS[i + 1];
  const span = k1.hour - k0.hour;
  const t = span > 0 ? THREE.MathUtils.clamp((h - k0.hour) / span, 0, 1) : 0;
  const s = t * t * (3 - 2 * t);
  const mix = (a: number, b: number) => THREE.MathUtils.lerp(a, b, s);
  const col = (c: THREE.Color, a: number, b: number) => c.setHex(a).lerp(scratch.setHex(b), s);

  col(out.sunColor, k0.sun, k1.sun);
  out.sunIntensity = mix(k0.sunIntensity, k1.sunIntensity) * rig.sun;
  out.elevation = mix(k0.elevation, k1.elevation);
  const az = ((h - 6) / 12) * Math.PI;
  const e = THREE.MathUtils.degToRad(out.elevation);
  out.sunDir.set(Math.cos(az) * Math.cos(e), Math.sin(e), 0.55 * Math.cos(e)).normalize();

  col(out.hemiSky, k0.hemiSky, k1.hemiSky);
  col(out.hemiGround, k0.hemiGround, k1.hemiGround);
  out.hemiIntensity = mix(k0.hemiIntensity, k1.hemiIntensity) * rig.hemi;
  out.fillIntensity = mix(k0.fill, k1.fill) * rig.hemi;
  out.exposure = mix(k0.exposure, k1.exposure);

  if (rig.sky !== undefined) {
    out.skyTop.setHex(rig.sky);
    out.skyHorizon.setHex(rig.sky);
    out.disc = 0;
  } else {
    col(out.skyTop, k0.skyTop, k1.skyTop);
    col(out.skyHorizon, k0.skyHorizon, k1.skyHorizon);
    out.disc = mix(k0.disc, k1.disc);
  }
  if (rig.fog !== undefined) out.fog.setHex(rig.fog);
  else col(out.fog, k0.fog, k1.fog);
  out.fogNear = rig.fogNear;
  out.fogFar = rig.fogFar;
  out.daylight = daylight(h);
  out.ambient
    .copy(out.hemiSky)
    .multiplyScalar(out.hemiIntensity * 0.9)
    .add(scratch.copy(out.sunColor).multiplyScalar(out.sunIntensity * 0.35 * Math.max(0.15, out.sunDir.y)));
  return out;
}
