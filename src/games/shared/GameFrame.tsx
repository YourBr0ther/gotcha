"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * The card every game plays inside: a one-line HUD, then the play area.
 * The area claims touch so a drag inside it never scrolls the page, and a
 * pause overlay covers it while the tab is hidden.
 */
export function GameFrame({
  hud,
  children,
  paused,
  height,
  areaProps,
  areaStyle,
}: {
  hud: ReactNode;
  children: ReactNode;
  paused: boolean;
  /** CSS height for the play area; omit to size to content. */
  height?: string;
  areaProps?: HTMLAttributes<HTMLDivElement>;
  areaStyle?: CSSProperties;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 font-pixel text-xs text-ink-dim">{hud}</div>
      <div
        {...areaProps}
        className={`relative select-none overflow-hidden ${areaProps?.className ?? ""}`}
        style={{ touchAction: "none", height, ...areaStyle, ...areaProps?.style }}
      >
        {children}
        {paused ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60" role="status">
            <span className="card card-strong px-5 py-3 font-pixel text-lg">Paused</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** HUD item: a label and a pixel-font value. */
export function Stat({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </span>
  );
}

/** Seconds left, whole, never below zero. */
export function secondsLeft(roundMs: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil((roundMs - elapsedMs) / 1000));
}
