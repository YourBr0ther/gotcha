"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { TimezoneSync } from "./TimezoneSync";

export interface Section {
  href: string;
  label: string;
  icon: PixelIconName;
}

/** Every screen but Home, in the order the More sheet and the desktop sidebar show them. */
export const SECTIONS: Section[] = [
  { href: "/party", label: "Party", icon: "party" },
  { href: "/pc", label: "PC", icon: "pc" },
  { href: "/journal", label: "Journal", icon: "book" },
  { href: "/pokedex", label: "Pokedex", icon: "pokeball" },
  { href: "/neighborhood", label: "Neighborhood", icon: "tree" },
  { href: "/settings", label: "Settings", icon: "stone" },
];

/** Reached from Home's care row rather than the More sheet: the store lives in Bag, the games in Play. */
export const SIDEBAR_ONLY: Section[] = [
  { href: "/store", label: "Store", icon: "store" },
  { href: "/games", label: "Games", icon: "games" },
];

function activeSection(pathname: string): string {
  if (pathname === "/") return "/";
  const hit = [...SECTIONS, ...SIDEBAR_ONLY].find((t) => pathname.startsWith(t.href));
  return hit?.href ?? "/";
}

/**
 * On a phone there is one menu, and it is Home's care row: Feed, Play,
 * Groom, Rest, Bag and More. Every other screen is one tap from Home
 * through its header, so no tab bar. From md up a sidebar lists the
 * sections, since a wide window has the room.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const current = activeSection(pathname);
  const all: Section[] = [{ href: "/", label: "Home", icon: "home" }, ...SIDEBAR_ONLY, ...SECTIONS];

  return (
    <div className="flex min-h-dvh">
      <TimezoneSync />
      <nav
        aria-label="Sections"
        className="card card-strong fixed inset-y-0 left-0 z-40 hidden w-56 flex-col gap-1 rounded-none p-3 md:flex"
        style={{ paddingTop: "calc(var(--spacing-safe-top) + 12px)", paddingLeft: "calc(var(--spacing-safe-left) + 12px)" }}
      >
        <div className="mb-3 flex items-center gap-2 px-2">
          <PixelIcon name="pokeball" size={28} />
          <span className="font-pixel text-lg">Gotcha</span>
        </div>
        {all.map((t) => {
          const active = current === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`tap flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-bold transition ${active ? "bg-white/14 text-ink" : "text-ink-dim hover:bg-white/8 hover:text-ink"}`}
            >
              <PixelIcon name={t.icon} size={22} />
              {t.label}
            </Link>
          );
        })}
      </nav>

      <main className="relative min-w-0 flex-1 md:pl-56">{children}</main>

      <div className="rotate-card" role="status">
        <div className="card flex items-center gap-3 px-4 py-3">
          <PixelIcon name="pokeball" size={28} />
          <span className="font-pixel text-sm">Turn your phone upright</span>
        </div>
      </div>
    </div>
  );
}
