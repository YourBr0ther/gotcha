"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";

export function Card({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" | "article" }) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

type Variant = "card" | "primary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  card: "card hover:bg-white/10 active:scale-[0.97]",
  primary: "bg-need-happiness text-black shadow-[inset_0_-3px_0_rgb(0_0_0/0.25)] hover:brightness-110 active:scale-[0.97]",
  ghost: "bg-white/8 hover:bg-white/14 active:scale-[0.97]",
  danger: "bg-danger/20 text-danger hover:bg-danger/30 active:scale-[0.97]",
};

export function Button({
  variant = "ghost",
  className = "",
  icon,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: PixelIconName }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-[12px] px-4 py-2 text-sm font-bold transition ${variants[variant]} ${className}`}
      {...rest}
    >
      {icon ? <PixelIcon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card flex items-center gap-3 p-3">
      <Skeleton className="h-12 w-12 rounded-xl" />
      <div className="flex flex-1 flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === 0 ? "w-2/3" : "w-1/2"}`} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="bob opacity-80">
        <PixelIcon name="pokeball" size={48} />
      </div>
      <p className="text-lg font-extrabold">{title}</p>
      {text ? <p className="max-w-xs text-sm text-ink-dim">{text}</p> : null}
      {action}
    </div>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const t = type.toLowerCase();
  return (
    <span
      className="rounded-md px-2 py-0.5 font-pixel text-[11px] uppercase tracking-wide text-black/85"
      style={{ background: `var(--color-type-${t}, #888)` }}
    >
      {t}
    </span>
  );
}

export function Hearts({ health, size = 20 }: { health: number; size?: number }) {
  const full = Math.round((Math.max(0, Math.min(100, health)) / 100) * 5);
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`Health ${Math.round(health)} of 100`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <PixelIcon key={i} name={i < full ? "heart" : "heartEmpty"} size={size} />
      ))}
    </div>
  );
}

export function Meter({ value, color, label, icon, compact = false }: { value: number; color: string; label: string; icon?: PixelIconName; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`flex items-center ${compact ? "gap-2" : "gap-2.5"}`}>
      {icon ? <PixelIcon name={icon} size={compact ? 20 : 30} /> : null}
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className={`${compact ? "text-xs" : "text-sm"} font-bold leading-none`}>{label}</span>
          {compact ? <span className="font-pixel text-[10px] text-ink-dim">{Math.round(pct)}</span> : null}
        </div>
        <div
          className="meter"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          style={{ ["--meter-color" as string]: color }}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, back, aside }: { title: string; back?: string; aside?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 pb-3">
      {back ? (
        <Link href={back} className="tap flex items-center justify-center rounded-lg text-ink-dim hover:bg-white/10" aria-label="Back">
          <PixelIcon name="arrowLeft" size={20} />
        </Link>
      ) : null}
      <h1 className="text-2xl font-extrabold drop-shadow">{title}</h1>
      <div className="ml-auto">{aside}</div>
    </header>
  );
}

export function BytesPill({ bytes }: { bytes: number | null | undefined }) {
  return (
    <span className="card inline-flex items-center gap-1.5 px-2.5 py-1 font-pixel text-sm text-bytes">
      <PixelIcon name="bytes" size={16} />
      {bytes === null || bytes === undefined ? "--" : bytes.toLocaleString()}
    </span>
  );
}
