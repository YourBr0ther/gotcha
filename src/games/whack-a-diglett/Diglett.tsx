import { PixelGlyph, type GlyphMap } from "../shared/PixelGlyph";

const DIGLETT: GlyphMap = {
  rows: [
    "......####......",
    "....##bbbb##....",
    "...#bbbbbbbb#...",
    "...#bbbbbbbb#...",
    "..#bbbbbbbbbb#..",
    "..#bb##bb##bb#..",
    "..#bb#wbb#wbb#..",
    "..#bbbbbbbbbb#..",
    "..#bbbbppbbbb#..",
    "..#bbbpPppbbb#..",
    "..#bbbbppbbbb#..",
    "..#bbbbbbbbbb#..",
    "..#bbbbbbbbbb#..",
    "..#bbbbbbbbbb#..",
    "..#bbbbbbbbbb#..",
    "..############..",
  ],
  palette: { "#": "#3b1f0e", b: "#a0623a", w: "#ffffff", p: "#e8707a", P: "#ffb3b8" },
};

const HIT: GlyphMap = {
  ...DIGLETT,
  rows: DIGLETT.rows.map((r, i) => (i === 5 ? "..#b#b#bb#b#b#.." : i === 6 ? "..#bb#bbbb#bb#.." : r)),
  palette: { ...DIGLETT.palette, b: "#c17b4c" },
};

export function Diglett({ size, hit = false, className }: { size: number; hit?: boolean; className?: string }) {
  return <PixelGlyph glyph={hit ? HIT : DIGLETT} size={size} className={className} title={hit ? "Diglett, whacked" : "Diglett"} />;
}

/** Three heads, the middle one a touch taller. */
export function Dugtrio({ size, hit = false }: { size: number; hit?: boolean }) {
  const head = size * 0.62;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={hit ? "Dugtrio, whacked" : "Dugtrio"}>
      <Diglett size={head} hit={hit} className="absolute bottom-0 left-0" />
      <Diglett size={head} hit={hit} className="absolute bottom-0 right-0" />
      <Diglett size={head} hit={hit} className="absolute left-1/2 top-0 -translate-x-1/2" />
    </div>
  );
}
