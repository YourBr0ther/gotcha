"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { daylight } from "./DayNight";
import type { Backdrop as BackdropDef } from "./dioramas/types";
import { useWorldStore } from "./WorldContext";

const WIDTH = 512;
const HEIGHT = 256;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint the blurred wall: a sky gradient and two rows of soft silhouettes,
 * the far row paler. The blur is the canvas filter where the browser has it
 * and plain soft shapes where it does not; either way it reads as depth of
 * field without a post pass.
 */
export function paintBackdrop(def: BackdropDef): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const r = rand(def.sky ^ def.silhouette);

  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, hex(def.sky));
  sky.addColorStop(0.62, hex(def.horizon));
  sky.addColorStop(1, hex(def.silhouette));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const sil = new THREE.Color(def.silhouette);
  const hor = new THREE.Color(def.horizon);
  const far = sil.clone().lerp(hor, 0.55);
  const near = sil.clone().lerp(hor, 0.2);
  const rows: Array<{ color: THREE.Color; base: number; scale: number; blur: number }> = [
    { color: far, base: HEIGHT * 0.66, scale: 0.7, blur: 7 },
    { color: near, base: HEIGHT * 0.8, scale: 1, blur: 4 },
  ];

  for (const row of rows) {
    ctx.save();
    try {
      ctx.filter = `blur(${row.blur}px)`;
    } catch {
      // Older WebKit: shapes stay crisp but the gradient still sells the distance.
    }
    ctx.fillStyle = `#${row.color.getHexString()}`;
    switch (def.style) {
      case "trees":
      case "reeds": {
        for (let x = -20; x < WIDTH + 20; x += 18 * row.scale) {
          const h = (40 + r() * 50) * row.scale;
          ctx.fillRect(x - 3 * row.scale, row.base - h, 6 * row.scale, h + HEIGHT);
          blob(ctx, x, row.base - h, (14 + r() * 10) * row.scale);
          blob(ctx, x + 8 * row.scale, row.base - h + 12 * row.scale, (12 + r() * 8) * row.scale);
          blob(ctx, x - 9 * row.scale, row.base - h + 10 * row.scale, (11 + r() * 8) * row.scale);
        }
        if (def.style === "reeds") {
          ctx.fillStyle = `#${row.color.clone().lerp(hor, 0.3).getHexString()}`;
          for (let x = 0; x < WIDTH; x += 5) {
            if (r() < 0.6) ctx.fillRect(x, row.base - (10 + r() * 30) * row.scale, 2, 60);
          }
        }
        break;
      }
      case "spruce": {
        for (let x = -10; x < WIDTH + 10; x += 16 * row.scale) {
          const h = (60 + r() * 60) * row.scale;
          const w = (14 + r() * 8) * row.scale;
          ctx.beginPath();
          ctx.moveTo(x, row.base - h);
          ctx.lineTo(x + w, row.base + 10);
          ctx.lineTo(x - w, row.base + 10);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillRect(0, row.base + 5, WIDTH, HEIGHT);
        break;
      }
      case "palms": {
        // Sea to the horizon, a low island, a few fans.
        ctx.fillStyle = `#${row.color.getHexString()}`;
        if (row.scale < 1) {
          ctx.fillRect(0, row.base, WIDTH, HEIGHT);
          blob(ctx, WIDTH * 0.25, row.base + 6, 60);
          blob(ctx, WIDTH * 0.78, row.base + 4, 40);
        } else {
          for (let i = 0; i < 6; i++) {
            const x = r() * WIDTH;
            const h = 50 + r() * 40;
            ctx.fillRect(x - 2, row.base - h, 4, h);
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2;
              ctx.beginPath();
              ctx.ellipse(x + Math.cos(a) * 12, row.base - h + Math.sin(a) * 6, 18, 5, a, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        break;
      }
      case "rock": {
        for (let x = -20; x < WIDTH + 20; x += 30 * row.scale) {
          const h = (50 + r() * 70) * row.scale;
          ctx.beginPath();
          ctx.moveTo(x, row.base + 20);
          ctx.lineTo(x + 8 * row.scale, row.base - h);
          ctx.lineTo(x + 20 * row.scale, row.base - h * 0.7);
          ctx.lineTo(x + 34 * row.scale, row.base + 20);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }
  return canvas;
}

const NIGHT_TINT = new THREE.Color(0x2a3358);

/** The painted wall behind the far edge of the scene. */
export function Backdrop({ def }: { def: BackdropDef }) {
  const store = useWorldStore();
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(paintBackdrop(def));
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [def]);
  useEffect(() => () => texture.dispose(), [texture]);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const scratch = useRef({ color: new THREE.Color(), applied: -1 });

  useFrame(() => {
    const m = material.current;
    if (!m) return;
    const hours = store.state.timeOfDay;
    const s = scratch.current;
    if (hours === s.applied) return;
    s.applied = hours;
    const light = def.style === "rock" ? 1 : daylight(hours);
    m.color.copy(NIGHT_TINT).lerp(s.color.set(0xffffff), light);
  });

  const width = def.height * (WIDTH / HEIGHT);
  return (
    <mesh position={[0.5, def.height / 2 - 1.5, def.z]}>
      <planeGeometry args={[width, def.height]} />
      <meshBasicMaterial ref={material} map={texture} toneMapped={false} />
    </mesh>
  );
}
