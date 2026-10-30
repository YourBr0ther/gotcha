/**
 * Emote bubbles: 8x8 pixel icons drawn onto a canvas and shown as a sprite
 * above the head. One texture per kind, built on first use.
 */

import * as THREE from "three";
import type { EmoteKind } from "../api";

const PALETTE: Record<string, string> = {
  ".": "rgba(0,0,0,0)",
  "#": "#ffffff",
  r: "#ff4d6d",
  p: "#ff8fb8",
  y: "#ffd64a",
  b: "#5ab5ff",
  k: "#1b1b1b",
  o: "#ff8a3d",
  g: "#56d36a",
};

const ICONS: Record<EmoteKind, string[]> = {
  love: [
    "........",
    ".rr..rr.",
    "rrrrrrrr",
    "rrrrrrrr",
    ".rrrrrr.",
    "..rrrr..",
    "...rr...",
    "........",
  ],
  happy: [
    "..yyyy..",
    ".yyyyyy.",
    "yykyykyy",
    "yyyyyyyy",
    "ykyyyyky",
    "yykkkkyy",
    ".yyyyyy.",
    "..yyyy..",
  ],
  sad: [
    "...b....",
    "...bb...",
    "..bbbb..",
    "..bbbb..",
    ".bbbbbb.",
    ".bbbbbb.",
    "..bbbb..",
    "........",
  ],
  angry: [
    "r......r",
    ".r....r.",
    "..r..r..",
    "........",
    "..r..r..",
    ".r....r.",
    "r......r",
    "........",
  ],
  question: [
    "..####..",
    ".##..##.",
    ".....##.",
    "....##..",
    "...##...",
    "...##...",
    "........",
    "...##...",
  ],
  surprise: [
    "...yy...",
    "...yy...",
    "...yy...",
    "...yy...",
    "...yy...",
    "........",
    "...yy...",
    "...yy...",
  ],
  sleepy: [
    "........",
    ".#####..",
    "....##..",
    "...##...",
    "..##....",
    ".#####..",
    "........",
    "........",
  ],
  music: [
    "....gg..",
    "....ggg.",
    "....g.gg",
    "....g...",
    "....g...",
    ".ggg....",
    ".gggg...",
    "..gg....",
  ],
};

const cache = new Map<EmoteKind, THREE.Texture>();

export function emoteTexture(kind: EmoteKind): THREE.Texture {
  const cached = cache.get(kind);
  if (cached) return cached;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rows = ICONS[kind];
  const cell = size / 8;
  // A soft dark backing disc so the icon reads over bright grass.
  ctx.fillStyle = "rgba(20,20,30,0.55)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      const color = PALETTE[row[x]];
      if (!color || row[x] === ".") continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * cell + 2, y * cell + 2, cell - 1, cell - 1);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(kind, texture);
  return texture;
}
