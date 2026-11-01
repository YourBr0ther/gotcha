"use client";

import { useEffect, useState } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { faceSprite, type FaceSprite } from "@/world/bedrock/face";
import { loadSpeciesBundle } from "@/world/bundle";
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

/** The portrait is this big at most; the face is scaled by a whole number so its pixels stay crisp. */
const PORTRAIT_PX = 64;

/** The head's front face, cropped out of the texture with `background-position`. */
function FacePortrait({ face, dim }: { face: FaceSprite; dim: boolean }) {
  const k = Math.max(1, Math.floor(PORTRAIT_PX / Math.max(face.width, face.height)));
  return (
    <div
      className="pixel"
      aria-hidden="true"
      style={{
        width: face.width * k,
        height: face.height * k,
        backgroundImage: `url("${face.url}")`,
        backgroundSize: `${face.textureWidth * k}px ${face.textureHeight * k}px`,
        backgroundPosition: `-${face.x * k}px -${face.y * k}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
        filter: dim ? "saturate(0.7)" : undefined,
      }}
    />
  );
}

/**
 * The active pokemon's take on the round: its face as a portrait and an
 * emote bubble. The face is the front of the model's head bone, found in
 * the species geometry; a species with no head bone falls back to the
 * top-left corner of its texture, where Cobblemon usually keeps the face.
 */
export function Reaction({ species, name, tier, seed = 0 }: { species: string; name: string; tier: ReactionTier; seed?: number }) {
  const [broken, setBroken] = useState(false);
  // The render audit's portrait first; an install without one crops the texture instead.
  const [portrait, setPortrait] = useState<{ species: string; ok: boolean }>({ species, ok: true });
  const usePortrait = portrait.species === species ? portrait.ok : true;
  // Keyed by species so a stale answer never shows on another pokemon;
  // undefined while the geometry loads, null when it has no usable head.
  const [found, setFound] = useState<{ species: string; face: FaceSprite | null } | null>(null);
  const face = found?.species === species ? found.face : undefined;
  const { icon, lines } = LINES[tier];
  const line = lines[Math.abs(seed) % lines.length];

  useEffect(() => {
    let alive = true;
    loadSpeciesBundle(species)
      .then((bundle) => alive && setFound({ species, face: faceSprite(bundle) ?? null }))
      .catch(() => alive && setFound({ species, face: null }));
    return () => {
      alive = false;
    };
  }, [species]);

  return (
    <div className="flex items-center gap-3" aria-label={`${name} says ${line}`}>
      <div className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 shadow-[inset_0_0_0_2px_var(--color-card-edge)] ${tier === "perfect" ? "bob" : ""}`}>
        {usePortrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- portraits come from the data volume, not next/image.
          <img
            src={`/api/assets/portraits/${species}`}
            alt=""
            width={80}
            height={80}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: tier === "meh" ? "saturate(0.7)" : undefined }}
            onError={() => setPortrait({ species, ok: false })}
          />
        ) : broken ? (
          <PixelIcon name="pokeball" size={56} className="absolute left-3 top-3" />
        ) : face ? (
          <FacePortrait face={face} dim={tier === "meh"} />
        ) : face === null ? (
          // eslint-disable-next-line @next/next/no-img-element -- species textures come from the asset cache, not next/image.
          <img
            src={`/api/assets/${species}/textures/${species}.png`}
            alt=""
            className="pixel absolute left-0 top-0"
            style={{ width: 160, height: 160, imageRendering: "pixelated", filter: tier === "meh" ? "saturate(0.7)" : undefined }}
            onError={() => setBroken(true)}
          />
        ) : null}
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
