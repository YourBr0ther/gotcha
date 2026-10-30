// Draws the Gotcha icon and banner as SVG. Run: node branding/generate.mjs
// Everything is rectangles and polygons on a pixel grid so it stays crisp.
import { writeFileSync } from "node:fs";

const FONT = {
  G: [".XXX.", "X...X", "X....", "X.XXX", "X...X", "X...X", ".XXX."],
  O: [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  T: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
  C: [".XXX.", "X...X", "X....", "X....", "X....", "X...X", ".XXX."],
  H: ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  A: [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
};

function word(text, x, y, px, fill, shadow) {
  let out = "";
  let cx = x;
  for (const ch of text) {
    const rows = FONT[ch];
    rows.forEach((row, ry) => {
      [...row].forEach((c, rx) => {
        if (c !== "X") return;
        if (shadow) out += `<rect x="${cx + rx * px + px * 0.35}" y="${y + ry * px + px * 0.35}" width="${px}" height="${px}" fill="${shadow}"/>`;
        out += `<rect x="${cx + rx * px}" y="${y + ry * px}" width="${px}" height="${px}" fill="${fill}"/>`;
      });
    });
    cx += 6 * px;
  }
  return out;
}

const HEART = ["..XX.XX..", ".XXXXXXX.", "XXXXXXXXX", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "...XXX...", "....X...."];
function heart(x, y, px) {
  let out = "";
  HEART.forEach((row, ry) => [...row].forEach((c, rx) => {
    if (c !== "X") return;
    const hi = (ry === 1 && rx === 2) || (ry === 2 && rx === 1);
    out += `<rect x="${x + rx * px}" y="${y + ry * px}" width="${px}" height="${px}" fill="${hi ? "#ffb3c7" : "#ff5c8a"}"/>`;
  }));
  return out;
}

/** An isometric grass block, origin at the top vertex. */
function block(x, y, s, colors = { top: "#7fd14b", topEdge: "#5cae33", left: "#8a5a2b", right: "#6b4420" }) {
  const w = s, h = s * 0.5;
  return `
  <polygon points="${x},${y} ${x + w},${y + h} ${x},${y + 2 * h} ${x - w},${y + h}" fill="${colors.top}"/>
  <polygon points="${x - w},${y + h} ${x},${y + 2 * h} ${x},${y + 2 * h + s} ${x - w},${y + h + s}" fill="${colors.left}"/>
  <polygon points="${x},${y + 2 * h} ${x + w},${y + h} ${x + w},${y + h + s} ${x},${y + 2 * h + s}" fill="${colors.right}"/>
  <polygon points="${x - w},${y + h} ${x},${y + 2 * h} ${x},${y + 2 * h + s * 0.22} ${x - w},${y + h + s * 0.22}" fill="${colors.topEdge}"/>
  <polygon points="${x},${y + 2 * h} ${x + w},${y + h} ${x + w},${y + h + s * 0.22} ${x},${y + 2 * h + s * 0.22}" fill="${colors.topEdge}"/>`;
}

function icon() {
  const S = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" shape-rendering="crispEdges">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#141826"/></linearGradient></defs>
  <rect width="${S}" height="${S}" rx="112" fill="url(#bg)"/>
  <ellipse cx="256" cy="392" rx="150" ry="26" fill="#000" opacity="0.35"/>
  ${block(256, 196, 128)}
  ${heart(256 - 4.5 * 20, 60, 20)}
</svg>`;
}

function banner() {
  const W = 1600, H = 520;
  let scene = "";
  // Far hills: rows of blocks.
  for (let i = -1; i < 14; i++) scene += block(80 + i * 128, 330, 64, { top: "#3f8f3a", topEdge: "#2f6d2b", left: "#2a2f44", right: "#1f2436" });
  for (let i = -1; i < 14; i++) scene += block(144 + i * 128, 372, 64, { top: "#4fa844", topEdge: "#3c8332", left: "#5a3a1c", right: "#452c14" });
  // Trees: trunk plus canopy blocks.
  const tree = (x, y, s) => `<rect x="${x - s * 0.22}" y="${y}" width="${s * 0.44}" height="${s * 1.6}" fill="#4b3119"/>` +
    block(x, y - s * 1.1, s, { top: "#4caf50", topEdge: "#3a8a3e", left: "#2e7d32", right: "#256428" }) +
    block(x - s * 0.9, y - s * 0.5, s * 0.8, { top: "#4caf50", topEdge: "#3a8a3e", left: "#2e7d32", right: "#256428" }) +
    block(x + s * 0.9, y - s * 0.45, s * 0.8, { top: "#4caf50", topEdge: "#3a8a3e", left: "#2e7d32", right: "#256428" });
  scene += tree(1300, 250, 70) + tree(1460, 290, 60) + tree(60, 280, 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2340"/><stop offset="0.7" stop-color="#2d4a7a"/><stop offset="1" stop-color="#3f6a9c"/></linearGradient>
    <clipPath id="round"><rect width="${W}" height="${H}" rx="28"/></clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <rect x="1180" y="70" width="64" height="64" fill="#ffe16b"/><rect x="1164" y="86" width="96" height="32" fill="#ffe16b"/><rect x="1196" y="54" width="32" height="96" fill="#ffe16b"/>
    ${[...Array(28)].map((_, i) => `<rect x="${(i * 173) % W}" y="${(i * 97) % 240 + 20}" width="4" height="4" fill="#fff" opacity="${0.3 + (i % 5) / 8}"/>`).join("")}
    ${scene}
    <rect x="0" y="430" width="${W}" height="${H - 430}" fill="#5cae33"/>
    <rect x="0" y="430" width="${W}" height="12" fill="#7fd14b"/>
    <rect x="0" y="470" width="${W}" height="${H - 470}" fill="#6b4420"/>
    ${[...Array(20)].map((_, i) => `<rect x="${i * 80 + 20}" y="${474 + (i % 3) * 10}" width="16" height="8" fill="#8a5a2b"/>`).join("")}
  </g>
  <g transform="translate(120,110)">
    <ellipse cx="128" cy="300" rx="120" ry="20" fill="#000" opacity="0.35"/>
    ${block(128, 120, 96)}
    ${heart(128 - 4.5 * 16, 10, 16)}
  </g>
  ${word("GOTCHA", 420, 150, 22, "#ffffff", "#0f1424")}
  <text x="424" y="372" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="40" fill="#dfe8ff">Gotta catch. Gotta care.</text>
  <text x="424" y="418" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="24" fill="#9fb3d9">A family tamagotchi. Cobblemon models, three.js dioramas, an LLM brain.</text>
</svg>`;
}

writeFileSync(new URL("./icon.svg", import.meta.url), icon());
writeFileSync(new URL("./banner.svg", import.meta.url), banner());
console.log("wrote branding/icon.svg and branding/banner.svg");
