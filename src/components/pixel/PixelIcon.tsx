/**
 * Pixel art icons drawn as 16x16 character maps and rendered as SVG rects
 * with crisp edges. Every glyph here is ours. `c` in a map means
 * currentColor so tab icons tint with their text.
 */

import type { CSSProperties } from "react";

type Palette = Record<string, string>;

interface Glyph {
  rows: string[];
  palette: Palette;
}

const OUTLINE = "#1f1f24";

const glyphs = {
  pokeball: {
    rows: [
      ".....######.....",
      "...##rrrrrr##...",
      "..#RRrrrrrrrr#..",
      ".#Rrrrrrrrrrrr#.",
      ".#rrrrrrrrrrrr#.",
      "#rrrrrrrrrrrrrr#",
      "#rrrrr####rrrrr#",
      "######wwww######",
      "######wwww######",
      "#wwwww####wwwww#",
      "#wwwwwwwwwwwwww#",
      ".#wwwwwwwwwwww#.",
      ".#wwwwwwwwwwww#.",
      "..#wwwwwwwwww#..",
      "...##wwwwww##...",
      ".....######.....",
    ],
    palette: { "#": OUTLINE, r: "#e8343c", R: "#ff7a7a", w: "#f4f4f4" },
  },
  heart: {
    rows: [
      "................",
      "...####..####...",
      "..#rrrr##rrrr#..",
      ".#rRrrrrrrrrrr#.",
      ".#rRrrrrrrrrrr#.",
      ".#rrrrrrrrrrrr#.",
      ".#rrrrrrrrrrrr#.",
      "..#rrrrrrrrrr#..",
      "...#rrrrrrrr#...",
      "....#rrrrrr#....",
      ".....#rrrr#.....",
      "......#rr#......",
      ".......##.......",
      "................",
    ],
    palette: { "#": "#4a1020", r: "#ff5c8a", R: "#ffa4c0" },
  },
  heartEmpty: {
    rows: [
      "................",
      "...####..####...",
      "..#gggg##gggg#..",
      ".#gggggggggggg#.",
      ".#gggggggggggg#.",
      ".#gggggggggggg#.",
      ".#gggggggggggg#.",
      "..#gggggggggg#..",
      "...#gggggggg#...",
      "....#gggggg#....",
      ".....#gggg#.....",
      "......#gg#......",
      ".......##.......",
      "................",
    ],
    palette: { "#": "#1a1a22", g: "#3a3a46" },
  },
  bond: {
    rows: [
      "................",
      "...####..####...",
      "..#pppp##pppp#..",
      ".#pPpppppppppp#.",
      ".#pPpppppppppp#.",
      ".#pppppppppppp#.",
      ".#pppppppppppp#.",
      "..#pppppppppp#..",
      "...#pppppppp#...",
      "....#pppppp#....",
      ".....#pppp#.....",
      "......#pp#......",
      ".......##.......",
      "................",
    ],
    palette: { "#": "#5a1a4a", p: "#ff6fb0", P: "#ffb3d6" },
  },
  happy: {
    rows: [
      ".....######.....",
      "...##yyyyyy##...",
      "..#yyyyyyyyyy#..",
      ".#yyyyyyyyyyyy#.",
      ".#yyy#yyyy#yyy#.",
      "#yyyy#yyyy#yyyy#",
      "#yyyyyyyyyyyyyy#",
      "#yyyyyyyyyyyyyy#",
      "#yy#yyyyyyyy#yy#",
      "#yyy#yyyyyy#yyy#",
      ".#yyy######yyy#.",
      ".#yyyyyyyyyyyy#.",
      "..#yyyyyyyyyy#..",
      "...##yyyyyy##...",
      ".....######.....",
    ],
    palette: { "#": "#5a3a00", y: "#ffd23f" },
  },
  hunger: {
    rows: [
      "................",
      "..........####..",
      ".........#tttt#.",
      "........#tttttt#",
      "........#tTtttt#",
      ".......#ttttttt#",
      "......#ttttttt#.",
      ".....#ttttttt#..",
      "....#bbtttt##...",
      "...#bbb####.....",
      "..#bbb#.........",
      ".#bbb#..........",
      "#bb#............",
      ".##.............",
    ],
    palette: { "#": "#4a2208", t: "#e0923a", T: "#f5c07a", b: "#f6e9c9" },
  },
  energy: {
    rows: [
      "................",
      "........zzzzzz..",
      "............zz..",
      "...........zz...",
      "..........zz....",
      ".........zz.....",
      "........zzzzzz..",
      "................",
      "..zzzzzz........",
      "......zz........",
      ".....zz.........",
      "....zz..........",
      "..zzzzzz........",
    ],
    palette: { z: "#3fa9f5" },
  },
  hygiene: {
    rows: [
      "................",
      ".......t........",
      ".......t........",
      "......ttt.......",
      ".....ttttt......",
      "..ttttttttttt...",
      ".ttttTtttttttt..",
      "..ttttttttttt...",
      ".....ttttt......",
      "......ttt.......",
      ".......t........",
      ".......t........",
    ],
    palette: { t: "#4fd8d0", T: "#c8fffb" },
  },
  apple: {
    rows: [
      ".......#........",
      "......##.gg.....",
      "......#.gg......",
      "...####.####....",
      "..#rrrr#rrrr#...",
      ".#rRrrrrrrrrr#..",
      ".#rRrrrrrrrrr#..",
      ".#rrrrrrrrrrr#..",
      ".#rrrrrrrrrrr#..",
      ".#rrrrrrrrrrr#..",
      "..#rrrrrrrrr#...",
      "..#rrrrrrrrr#...",
      "...#rrr#rrr#....",
      "....###.###.....",
    ],
    palette: { "#": "#4a1010", r: "#e5322d", R: "#ff8a80", g: "#5ad64b" },
  },
  berry: {
    rows: [
      "................",
      "................",
      "................",
      ".......#........",
      "......#g........",
      "....###g###.....",
      "...#bbbbbbb#....",
      "..#bBbbbbbbb#...",
      "..#bBbbbbbbb#...",
      "..#bbbbbbbbb#...",
      "..#bbbbbbbbb#...",
      "...#bbbbbbb#....",
      "....#######.....",
    ],
    palette: { "#": "#1c2a5a", b: "#4a6cf0", B: "#8fa6ff", g: "#5ad64b" },
  },
  poffin: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "....########....",
      "...#pPPPPPPp#...",
      "..#ppPPPPPPpp#..",
      "..#pppppppppp#..",
      "..#pppppppppp#..",
      "..#pppppppppp#..",
      "...#pppppppp#...",
      "....########....",
    ],
    palette: { "#": "#5a2a3a", p: "#f08aa8", P: "#ffc2d4" },
  },
  curry: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "....########....",
      "...#cccccccc#...",
      "..#cCcccccccc#..",
      "################",
      ".#wwwwwwwwwwww#.",
      ".#wwwwwwwwwwww#.",
      "..#wwwwwwwwww#..",
      "...##wwwwww##...",
      ".....######.....",
    ],
    palette: { "#": "#3a2a1a", c: "#d9842b", C: "#f0b060", w: "#e8e8f0" },
  },
  potion: {
    rows: [
      "................",
      "......####......",
      "......#pp#......",
      "......#pp#......",
      ".....##pp##.....",
      "....#......#....",
      "...#........#...",
      "...#........#...",
      "...#..mmmm..#...",
      "...#.mmmmmm.#...",
      "...#.mmmmmm.#...",
      "...#.mmmmmm.#...",
      "....#.mmmm.#....",
      ".....######.....",
    ],
    palette: { "#": "#2a2a44", p: "#c8c8d8", m: "#ff5c8a" },
  },
  medicine: {
    rows: [
      "................",
      "......####......",
      "......#pp#......",
      "......#pp#......",
      ".....##pp##.....",
      "....#......#....",
      "...#........#...",
      "...#........#...",
      "...#..mmmm..#...",
      "...#.mmmmmm.#...",
      "...#.mmmmmm.#...",
      "...#.mmmmmm.#...",
      "....#.mmmm.#....",
      ".....######.....",
    ],
    palette: { "#": "#2a2a44", p: "#c8c8d8", m: "#c47bff" },
  },
  flowerpot: {
    rows: [
      "................",
      "................",
      ".....pppp.......",
      "....pPyyPp......",
      "....pPyyPp......",
      ".....pppp.......",
      ".......g........",
      ".....g.g........",
      "......gg........",
      "..############..",
      "..#tttttttttt#..",
      "...#tttttttt#...",
      "...#tttttttt#...",
      "....########....",
    ],
    palette: { "#": "#3b2210", t: "#c0683a", p: "#ff6fb0", P: "#ffa4cf", y: "#ffd23f", g: "#5ad64b" },
  },
  tree: {
    rows: [
      "................",
      "......####......",
      "....##gggg##....",
      "...#gggggggg#...",
      "..#gGggggggGg#..",
      "..#gggggggggg#..",
      ".#gggggggggggg#.",
      ".#gggggggggggg#.",
      "..#gggggggggg#..",
      "...##gggggg##...",
      ".....#tttt#.....",
      ".....#tttt#.....",
      ".....#tttt#.....",
      ".....######.....",
    ],
    palette: { "#": "#1e3a12", g: "#4caf3c", G: "#7ad66a", t: "#8b5a2b" },
  },
  stone: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      ".....######.....",
      "....#sSSSss#....",
      "...#sSSSssss#...",
      "...#ssssssss#...",
      "...#ssssssss#...",
      "....#ssssss#....",
      ".....######.....",
    ],
    palette: { "#": "#2a2a44", s: "#8a8aa8", S: "#c8c8e0" },
  },
  brush: {
    rows: [
      "................",
      "....######......",
      "...#bbbbbb#.....",
      "..#bwbwbwbb#....",
      "..#bbbbbbbb#....",
      "..#bwbwbwbb#....",
      "..#bbbbbbbb#....",
      "..#bwbwbwbb#....",
      "...#bbbbbb#.....",
      "....#hhhh#......",
      ".....#hh#.......",
      ".....#hh#.......",
      ".....#hh#.......",
      ".....#hh#.......",
      "......##........",
    ],
    palette: { "#": "#1c2a4a", b: "#4a90e2", w: "#cfe6ff", h: "#8fb4e8" },
  },
  pillow: {
    rows: [
      "................",
      "................",
      "............zz..",
      "...........z....",
      "..........zz....",
      ".#########......",
      "#wwwwwwwww##....",
      "#wwWwwwwwwww#...",
      "#wwwwwwwwwwww#..",
      "#wwwwwwwwwwww#..",
      "#wwwwwwwwwwww#..",
      ".#wwwwwwwwwww#..",
      "..###########...",
    ],
    palette: { "#": "#5b6b8a", w: "#f2f5ff", W: "#ffffff", z: "#3fa9f5" },
  },
  bag: {
    rows: [
      "................",
      "......####......",
      ".....#....#.....",
      ".....#....#.....",
      "..############..",
      ".#bbbbbbbbbbbb#.",
      ".#bbbbbbbbbbbb#.",
      ".#bBBBBBBBBBBb#.",
      ".#bBBBBBBBBBBb#.",
      ".#bBBBByyBBBBb#.",
      ".#bBBBByyBBBBb#.",
      ".#bbbbbbbbbbbb#.",
      ".#bbbbbbbbbbbb#.",
      "..############..",
    ],
    palette: { "#": "#3b2210", b: "#a8672f", B: "#c98a4b", y: "#ffd84a" },
  },
  mic: {
    rows: [
      "................",
      "......####......",
      ".....#mmmm#.....",
      ".....#mmmm#.....",
      ".....#mmmm#.....",
      ".....#mmmm#.....",
      ".....#mmmm#.....",
      ".....#mmmm#.....",
      "...#.#mmmm#.#...",
      "...#..####..#...",
      "....#......#....",
      ".....######.....",
      ".......##.......",
      ".......##.......",
      ".....######.....",
    ],
    palette: { "#": "#ffffff", m: "#ffd6e2" },
  },
  camera: {
    rows: [
      "................",
      "................",
      "................",
      ".....####.......",
      ".##############.",
      "#wwwwwwwwwwwwww#",
      "#wwww######wwww#",
      "#www#llllll#www#",
      "#www#llLlll#www#",
      "#www#llllll#www#",
      "#wwww######wwww#",
      "#wwwwwwwwwwwwww#",
      ".##############.",
    ],
    palette: { "#": "#2a2a33", w: "#e6e6ee", l: "#3a8ed8", L: "#9cd0ff" },
  },
  book: {
    rows: [
      "................",
      "................",
      "..###########...",
      ".#ooooooooooo##.",
      ".#ooooooooooo#p#",
      ".#oo#####oooo#p#",
      ".#ooooooooooo#p#",
      ".#oo#####oooo#p#",
      ".#ooooooooooo#p#",
      ".#oo#####oooo#p#",
      ".#ooooooooooo#p#",
      ".#ooooooooooo#p#",
      ".#ooooooooooo##.",
      "..###########...",
    ],
    palette: { "#": "#3b2210", o: "#e0a04a", p: "#f6e9c9" },
  },
  sun: {
    rows: [
      "................",
      ".......yy.......",
      "...y...yy...y...",
      "....y.####.y....",
      ".....#yyyy#.....",
      "....#yYyyyy#....",
      ".yy.#yyyyyy#.yy.",
      "....#yyyyyy#....",
      ".....#yyyy#.....",
      "....y.####.y....",
      "...y...yy...y...",
      ".......yy.......",
    ],
    palette: { "#": "#d9a400", y: "#ffd23f", Y: "#fff0a0" },
  },
  cloud: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "......####......",
      ".....#wwww#.....",
      "...##wwwwww##...",
      "..#wwwwwwwwww#..",
      ".#wwwwwwwwwwww#.",
      ".#wwwwwwwwwwww#.",
      "..############..",
    ],
    palette: { "#": "#8a94a8", w: "#eef2ff" },
  },
  rain: {
    rows: [
      "................",
      "................",
      "......####......",
      ".....#wwww#.....",
      "...##wwwwww##...",
      "..#wwwwwwwwww#..",
      ".#wwwwwwwwwwww#.",
      "..############..",
      "...b...b...b....",
      "..b...b...b.....",
      "................",
      "...b...b...b....",
      "..b...b...b.....",
    ],
    palette: { "#": "#8a94a8", w: "#dde4f5", b: "#3fa9f5" },
  },
  snow: {
    rows: [
      "................",
      "................",
      "......####......",
      ".....#wwww#.....",
      "...##wwwwww##...",
      "..#wwwwwwwwww#..",
      ".#wwwwwwwwwwww#.",
      "..############..",
      "...s...s...s....",
      "................",
      ".s...s...s...s..",
      "................",
      "...s...s...s....",
    ],
    palette: { "#": "#8a94a8", w: "#eef2ff", s: "#ffffff" },
  },
  moon: {
    rows: [
      "................",
      "................",
      "......#####.....",
      "....##mmmm##....",
      "...#mmmm####....",
      "..#mmmm#........",
      "..#mmm#.........",
      "..#mmm#.........",
      "..#mmm#.........",
      "..#mmmm#........",
      "...#mmmm####....",
      "....##mmmm##....",
      "......#####.....",
    ],
    palette: { "#": "#8c8a5a", m: "#fff3b0" },
  },
  bytes: {
    rows: [
      "................",
      ".....######.....",
      "...##yyyyyy##...",
      "..#yyYYyyyyyy#..",
      ".#yyYyyyyyyyyy#.",
      ".#yyyy####yyyy#.",
      "#yyyy#yyyy#yyyy#",
      "#yyyy#####yyyyy#",
      "#yyyy#yyyy#yyyy#",
      "#yyyy#yyyy#yyyy#",
      ".#yyyy####yyyy#.",
      ".#yyyyyyyyyyyy#.",
      "..#yyyyyyyyyy#..",
      "...##yyyyyy##...",
      ".....######.....",
    ],
    palette: { "#": "#6a4a00", y: "#ffd84a", Y: "#fff3b0" },
  },
  // Tab bar glyphs tint with currentColor.
  home: {
    rows: [
      "................",
      "................",
      ".......cc.......",
      "......cccc......",
      ".....cc..cc.....",
      "....cc....cc....",
      "...cc......cc...",
      "..cc........cc..",
      "..c.cccccccc.c..",
      "....c......c....",
      "....c..cc..c....",
      "....c..cc..c....",
      "....c..cc..c....",
      "....cccccccc....",
    ],
    palette: { c: "currentColor" },
  },
  party: {
    rows: [
      "................",
      ".....cccccc.....",
      "...cc......cc...",
      "..c..........c..",
      ".c............c.",
      ".c............c.",
      "c.....cccc.....c",
      "ccccccc..ccccccc",
      "ccccccc..ccccccc",
      "c.....cccc.....c",
      ".c............c.",
      ".c............c.",
      "..c..........c..",
      "...cc......cc...",
      ".....cccccc.....",
    ],
    palette: { c: "currentColor" },
  },
  pc: {
    rows: [
      "................",
      "................",
      "cccccccccccccccc",
      "c..............c",
      "c.cccccccccccc.c",
      "c.c..........c.c",
      "c.c..........c.c",
      "c.c..........c.c",
      "c.c..........c.c",
      "c.cccccccccccc.c",
      "c..............c",
      "cccccccccccccccc",
      ".......cc.......",
      "....cccccccc....",
    ],
    palette: { c: "currentColor" },
  },
  store: {
    rows: [
      "................",
      "................",
      "cccccccccccccccc",
      "c..............c",
      "cc.cc.cc.cc.cc.c",
      ".cccccccccccccc.",
      "..c..........c..",
      "..c..........c..",
      "..c...cccc...c..",
      "..c...c..c...c..",
      "..c...c..c...c..",
      "..c...c..c...c..",
      "..cccccccccccc..",
    ],
    palette: { c: "currentColor" },
  },
  games: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "...cccccccccc...",
      "..c..........c..",
      ".c...c.....c..c.",
      ".c..ccc.......c.",
      ".c...c....c...c.",
      ".c............c.",
      "..cc........cc..",
      "...cccccccccc...",
    ],
    palette: { c: "currentColor" },
  },
  more: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      ".cc....cc....cc.",
      ".cc....cc....cc.",
    ],
    palette: { c: "currentColor" },
  },
  arrowLeft: {
    rows: [
      "................",
      "................",
      "................",
      ".......c........",
      "......cc........",
      ".....ccc........",
      "....cccccccccc..",
      "...ccccccccccc..",
      "....cccccccccc..",
      ".....ccc........",
      "......cc........",
      ".......c........",
    ],
    palette: { c: "currentColor" },
  },
  arrowRight: {
    rows: [
      "................",
      "................",
      "................",
      "........c.......",
      "........cc......",
      "........ccc.....",
      "..cccccccccc....",
      "..ccccccccccc...",
      "..cccccccccc....",
      "........ccc.....",
      "........cc......",
      "........c.......",
    ],
    palette: { c: "currentColor" },
  },
  close: {
    rows: [
      "................",
      "................",
      "................",
      "...cc......cc...",
      "....cc....cc....",
      ".....cc..cc.....",
      "......cccc......",
      ".......cc.......",
      "......cccc......",
      ".....cc..cc.....",
      "....cc....cc....",
      "...cc......cc...",
    ],
    palette: { c: "currentColor" },
  },
  check: {
    rows: [
      "................",
      "................",
      "................",
      "............cc..",
      "...........cc...",
      "..........cc....",
      ".........cc.....",
      "..cc....cc......",
      "...cc..cc.......",
      "....cccc........",
      ".....cc.........",
    ],
    palette: { c: "currentColor" },
  },
  warn: {
    rows: [
      "................",
      ".......cc.......",
      "......cccc......",
      "......cccc......",
      ".....cc..cc.....",
      ".....cc..cc.....",
      "....cc....cc....",
      "....cc.cc.cc....",
      "...cc..cc..cc...",
      "...cc......cc...",
      "..cc...cc...cc..",
      "..cccccccccccc..",
    ],
    palette: { c: "currentColor" },
  },
} satisfies Record<string, Glyph>;

export type PixelIconName = keyof typeof glyphs;

export const PIXEL_ICON_NAMES = Object.keys(glyphs) as PixelIconName[];

interface Props {
  name: PixelIconName;
  /** Rendered size in CSS pixels. The grid is 16. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Overrides palette entries, for tinted berries and potions. */
  tint?: Palette;
  title?: string;
}

export function PixelIcon({ name, size = 32, className, style, tint, title }: Props) {
  const glyph: Glyph = glyphs[name];
  const palette = tint ? { ...glyph.palette, ...tint } : glyph.palette;
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  glyph.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const fill = palette[ch];
      if (!fill) {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w += 1;
      rects.push({ x, y, w, fill });
      x += w;
    }
  });
  return (
    <svg
      className={`pixel ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

/** Renders a glyph to a data URL, for places that need an <img> (the PWA icon preview, canvases). */
export function pixelIconSvg(name: PixelIconName, size = 64): string {
  const glyph: Glyph = glyphs[name];
  let body = "";
  glyph.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = glyph.palette[ch];
      if (fill) body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    });
  });
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges">${body}</svg>`,
  )}`;
}
