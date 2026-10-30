"use client";

import Link from "next/link";
import { useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { TABS } from "@/components/shell/AppShell";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Round menu button for Home on a phone, where the tab bar is hidden so
 * the world and the microphone own the bottom edge. Opens a sheet with
 * the same tabs and pixel icons.
 */
export function MenuButton({ className = "" }: { className?: string }) {
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
        className={`card flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 active:scale-95 ${className}`}
      >
        <PixelIcon name="menu" size={22} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Go to">
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
