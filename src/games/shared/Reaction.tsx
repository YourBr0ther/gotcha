"use client";

import { useState } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { PixelGlyph, type GlyphMap } from "./PixelGlyph";

export type ReactionTier = "perfect" | "good" | "meh";

export function reactionTier(score: number, perfect: boolean): ReactionTier {
  if (perfect) return "perfect";
  return score >= 0.6 ? "good" : "meh";
}

const SAD: GlyphMap = {
  rows: [
    "................",
    "................",
    "...##.....##....",
    "...##.....##....",
    "................",
    "................",
    "......####......",
    ".....#....#.....",
    "....#......#....",
    "................",
  ],
  palette: { "#": "#1f1f24" },
};

const LINES: Record<ReactionTier, { icon: PixelIconName | null; lines: string[] }> = {
  perfect: { icon: "heart", lines: ["Perfect!!", "You did it!", "Best round ever!"] },
  good: { icon: "happy", lines: ["Nice one!", "That was fun!", "Again, again!"] },
  meh: { icon: null, lines: ["Aw... next time.", "Almost had it.", "We'll get them."] },
};

/**
 * The active pokemon's take on the round: its texture as a portrait and an
 * emote bubble. The texture is the model's atlas, so the portrait shows its
 * top-left corner where Cobblemon keeps the face.
 */
export function Reaction({ species, name, tier, seed = 0 }: { species: string; name: string; tier: ReactionTier; seed?: number }) {
  const [broken, setBroken] = useState(false);
  const { icon, lines } = LINES[tier];
  const line = lines[Math.abs(seed) % lines.length];
  return (
    <div className="flex items-center gap-3" aria-label={`${name} says ${line}`}>
      <div className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-white/10 shadow-[inset_0_0_0_2px_var(--color-card-edge)] ${tier === "perfect" ? "bob" : ""}`}>
        {broken ? (
          <PixelIcon name="pokeball" size={56} className="absolute left-3 top-3" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- species textures come from the asset cache, not next/image.
          <img
            src={`/api/assets/${species}/textures/${species}.png`}
            alt=""
            className="pixel absolute left-0 top-0"
            style={{ width: 160, height: 160, imageRendering: "pixelated", filter: tier === "meh" ? "saturate(0.7)" : undefined }}
            onError={() => setBroken(true)}
          />
        )}
      </div>
      <div className="relative rounded-2xl bg-white px-3 py-2 text-black shadow-[0_3px_0_rgb(0_0_0/0.35)]">
        <span className="absolute -left-2 top-1/2 h-0 w-0 -translate-y-1/2 border-y-8 border-r-8 border-y-transparent border-r-white" aria-hidden="true" />
        <span className="flex items-center gap-2 font-pixel text-sm">
          {icon ? <PixelIcon name={icon} size={18} /> : <PixelGlyph glyph={SAD} size={18} />}
          {line}
        </span>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-black/55">{name}</span>
      </div>
    </div>
  );
}
