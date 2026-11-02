"use client";

import Link from "next/link";
import { useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { TABS } from "@/components/shell/AppShell";
import { Sheet } from "@/components/ui/Sheet";

/**
 * The sections menu for Home on a phone, where the tab bar is hidden so
 * the world owns the bottom edge. One button, in the same column as Photo
 * and Journal at the top right so Home has a single set of controls;
 * round at the bottom corner only on the starter screen, which has no
 * HUD. Opens a sheet with the same tabs and pixel icons as the tab bar.
 */
export function MenuButton({ className = "", square = false }: { className?: string; square?: boolean }) {
  const [open, setOpen] = useState(false);
  const tabs = TABS.filter((t) => t.href !== "/");
  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`card flex items-center justify-center hover:bg-white/10 active:scale-95 ${square ? "h-12 w-12" : "h-11 w-11 rounded-full"} ${className}`}
      >
        <PixelIcon name="menu" size={square ? 30 : 22} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Menu">
        <ul className="grid grid-cols-5 gap-2 pb-1" aria-label="Sections">
          {tabs.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                onClick={() => setOpen(false)}
                className="tap flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[12px] bg-white/8 text-[11px] font-bold text-ink-dim hover:bg-white/14 hover:text-ink"
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
