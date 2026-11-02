"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { TimezoneSync } from "./TimezoneSync";

interface Tab {
  href: string;
  label: string;
  icon: PixelIconName;
}

export const TABS: Tab[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/party", label: "Party", icon: "party" },
  { href: "/pc", label: "PC", icon: "pc" },
  { href: "/store", label: "Store", icon: "store" },
  { href: "/games", label: "Games", icon: "games" },
  { href: "/more", label: "More", icon: "more" },
];

const MORE_ROUTES = ["/more", "/neighborhood", "/pokedex", "/journal", "/settings"];

function activeTab(pathname: string): string {
  if (pathname === "/") return "/";
  if (MORE_ROUTES.some((r) => pathname.startsWith(r))) return "/more";
  const hit = TABS.find((t) => t.href !== "/" && pathname.startsWith(t.href));
  return hit?.href ?? "/";
}

/**
 * Bottom tab bar on phones, sidebar from md up. Home has no bar on a phone:
 * the world fills the viewport, as in the concept render, and the HUD's
 * menu button opens the same tabs in a sheet.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const current = activeTab(pathname);
  const isHome = current === "/";

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
        {TABS.map((t) => {
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

      <main className={`relative min-w-0 flex-1 md:pl-56 ${isHome ? "" : "pb-[calc(var(--spacing-tab)+var(--spacing-safe-bottom))] md:pb-0"}`}>{children}</main>

      <div className="rotate-card" role="status">
        <div className="card flex items-center gap-3 px-4 py-3">
          <PixelIcon name="pokeball" size={28} />
          <span className="font-pixel text-sm">Turn your phone upright</span>
        </div>
      </div>

      {isHome ? null : (
        <nav
          aria-label="Sections"
          className="card card-strong fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 rounded-none border-t border-white/10 md:hidden"
          style={{ height: "calc(var(--spacing-tab) + var(--spacing-safe-bottom))", paddingBottom: "var(--spacing-safe-bottom)" }}
        >
          {TABS.map((t) => {
            const active = current === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`tap flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition ${active ? "text-ink" : "text-ink-faint"}`}
              >
                <PixelIcon name={t.icon} size={22} />
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
