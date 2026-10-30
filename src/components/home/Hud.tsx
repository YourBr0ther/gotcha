"use client";

import { useSyncExternalStore } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { Hearts } from "@/components/ui/primitives";
import { clockParts, genderGlyph } from "@/components/lib/format";
import type { PokemonView, Weather } from "@/components/lib/api";
import type { NeedName } from "@gotcha/cpkmn";

export function NameCard({ view }: { view: PokemonView }) {
  const g = genderGlyph(view.gender);
  return (
    <div className="card flex w-[196px] items-center gap-2.5 px-2.5 py-2">
      <PixelIcon name="pokeball" size={38} />
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[17px] font-extrabold leading-tight">{view.name}</span>
          {view.shiny ? <PixelIcon name="hygiene" size={12} title="shiny" /> : null}
        </div>
        <span className="font-pixel text-[12px] text-ink-dim">Lv. {view.level}</span>
        <div className="mt-0.5">
          <Hearts health={view.needs.health} size={17} />
        </div>
      </div>
      <span className={`ml-auto self-start text-xl font-bold leading-none ${g.className}`} aria-label={g.label} role="img">
        {g.glyph}
      </span>
    </div>
  );
}

export interface MeterSpec {
  need: NeedName;
  label: string;
  icon: PixelIconName;
  color: string;
}

export const HUD_METERS: MeterSpec[] = [
  { need: "fun", label: "Happiness", icon: "happy", color: "var(--color-need-happiness)" },
  { need: "hunger", label: "Hunger", icon: "hunger", color: "var(--color-need-hunger)" },
  { need: "energy", label: "Energy", icon: "energy", color: "var(--color-need-energy)" },
  { need: "affection", label: "Bond", icon: "bond", color: "var(--color-need-bond)" },
];

/** Floating "+12" labels that appear when a care action moves a meter. */
export type Deltas = Partial<Record<NeedName, number>>;

export function MetersCard({ view, deltas }: { view: PokemonView; deltas: Deltas }) {
  return (
    <div className="card flex w-[196px] flex-col gap-2 px-2.5 py-2.5">
      {HUD_METERS.map((m) => {
        const value = Math.max(0, Math.min(100, view.needs[m.need]));
        const delta = deltas[m.need];
        return (
          <div key={m.need} className="relative flex items-center gap-2">
            <PixelIcon name={m.icon} size={26} />
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[12px] font-bold leading-none">{m.label}</span>
              <div
                className="meter h-2"
                role="meter"
                aria-label={m.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(value)}
                style={{ ["--meter-color" as string]: m.color }}
              >
                <i style={{ width: `${value}%` }} />
              </div>
            </div>
            {delta ? (
              <span
                className="toast-enter absolute -top-1 right-0 font-pixel text-xs"
                style={{ color: delta > 0 ? "var(--color-need-happiness)" : "var(--color-danger)" }}
                aria-hidden="true"
              >
                {delta > 0 ? "+" : ""}
                {Math.round(delta)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function weatherGlyph(weather: Weather | null, hours: number): PixelIconName {
  const night = hours < 6 || hours >= 20;
  if (!weather) return night ? "moon" : "sun";
  const c = weather.code;
  if (c === 0 || c === 1) return night ? "moon" : "sun";
  if (c === 2 || c === 3 || c === 45 || c === 48) return "cloud";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 51) return "rain";
  return night ? "moon" : "sun";
}

/** The wall clock, ticking every 15 seconds. 0 on the server so the first paint shows a placeholder. */
let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const getClock = () => clockNow || Date.now();
const getServerClock = () => 0;

export function ClockCard({ weather }: { weather: Weather | null }) {
  const ms = useSyncExternalStore(subscribeClock, getClock, getServerClock);
  const now = ms ? new Date(ms) : null;
  const parts = now ? clockParts(now) : { time: "--:--", date: "" };
  const hours = now ? now.getHours() + now.getMinutes() / 60 : 12;
  return (
    <div className="card flex items-center gap-2 whitespace-nowrap px-2.5 py-1.5">
      <PixelIcon name={hours < 6 || hours >= 20 ? "moon" : "sun"} size={24} />
      <div className="flex flex-col leading-tight">
        <span className="font-pixel text-[13px]">{parts.time}</span>
        <span className="text-[10px] text-ink-dim">{parts.date}</span>
      </div>
      <div className="h-7 w-px bg-white/15" aria-hidden="true" />
      <div className="flex flex-col items-center leading-tight" aria-label={weather ? `${weather.tempF} degrees` : "clear"}>
        <PixelIcon name={weatherGlyph(weather, hours)} size={20} />
        <span className="font-pixel text-[10px]">{weather ? `${weather.tempF}°F` : "clear"}</span>
      </div>
    </div>
  );
}

export function SquareButton({ icon, label, badge, onClick }: { icon: PixelIconName; label: string; badge?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="card relative flex h-12 w-12 items-center justify-center hover:bg-white/10 active:scale-95">
      <PixelIcon name={icon} size={30} />
      {badge ? <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-black/60" aria-label="new entry" /> : null}
    </button>
  );
}

export function ActionButton({ icon, label, onClick, disabled }: { icon: PixelIconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="card flex h-[68px] flex-1 flex-col items-center justify-center gap-1 px-1 hover:bg-white/10 active:scale-95 md:h-[80px] md:w-24 md:flex-none"
    >
      <PixelIcon name={icon} size={32} />
      <span className="text-[13px] font-bold leading-none">{label}</span>
    </button>
  );
}
