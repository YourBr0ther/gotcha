"use client";

import { useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";

/**
 * A pokemon's face, from the portrait the render audit produced, on every
 * list and card that names one. Falls back to a pokeball when the data
 * volume has no portrait for the species. Keyed on the species so a
 * fallback for one row never sticks to the next.
 */
export function Face({ species, size = 40, className = "", rounded = "rounded-xl" }: { species: string; size?: number; className?: string; rounded?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === species) {
    return (
      <span className={`flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <PixelIcon name="pokeball" size={Math.round(size * 0.7)} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- portraits come from the data volume, not next/image.
    <img
      src={`/api/assets/portraits/${species}`}
      alt=""
      width={size}
      height={size}
      decoding="async"
      onError={() => setBroken(species)}
      className={`shrink-0 bg-white/10 object-cover ${rounded} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
