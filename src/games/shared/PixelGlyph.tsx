import type { CSSProperties } from "react";

export interface GlyphMap {
  rows: readonly string[];
  palette: Record<string, string>;
}

/**
 * PixelIcon's renderer for any grid size: rows of characters, a palette,
 * crisp rects. Game art lives next to its game and goes through this.
 */
export function PixelGlyph({
  glyph,
  size,
  className,
  style,
  title,
}: {
  glyph: GlyphMap;
  /** CSS width; height follows the grid's aspect. */
  size: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const cols = Math.max(...glyph.rows.map((r) => r.length));
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  glyph.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const fill = glyph.palette[ch];
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
      height={(size * glyph.rows.length) / cols}
      viewBox={`0 0 ${cols} ${glyph.rows.length}`}
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
