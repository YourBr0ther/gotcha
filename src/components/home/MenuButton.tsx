"use client";

import Link from "next/link";
import { useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { SECTIONS } from "@/components/shell/AppShell";
import { Sheet } from "@/components/ui/Sheet";

/**
 * More: the last button of Home's care row, opening a sheet of the
 * sections that are not a care action (Party, PC, Journal, Pokedex,
 * Neighborhood, Settings). The store is reached through Bag and the games
 * through Play, so Home has one menu. The round form sits in the corner
 * of the starter screen, which has no care row yet.
 */
export function MoreButton({ variant = "action", className = "" }: { variant?: "action" | "round"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "round" ? (
        <button type="button" aria-label="More" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={`card flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 active:scale-95 ${className}`}>
          <PixelIcon name="menu" size={22} />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={`card flex h-[68px] flex-1 flex-col items-center justify-center gap-1 px-1 hover:bg-white/10 active:scale-95 md:h-[80px] md:w-24 md:flex-none ${className}`}
        >
          <PixelIcon name="more" size={32} />
          <span className="text-[13px] font-bold leading-none">More</span>
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="More">
        <ul className="grid grid-cols-3 gap-2 pb-1" aria-label="Sections">
          {SECTIONS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                onClick={() => setOpen(false)}
                className="tap flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[12px] bg-white/8 text-[12px] font-bold text-ink-dim hover:bg-white/14 hover:text-ink"
              >
                <PixelIcon name={t.icon} size={26} />
                <span>{t.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
