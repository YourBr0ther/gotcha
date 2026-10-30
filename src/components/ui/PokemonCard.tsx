"use client";

import type { ReactNode } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Hearts } from "@/components/ui/primitives";
import { genderGlyph, MOOD_FACE, titleCase } from "@/components/lib/format";
import type { PokemonView } from "@/components/lib/api";

const NEEDS: Array<{ key: "fun" | "hunger" | "energy" | "affection"; color: string }> = [
  { key: "fun", color: "var(--color-need-happiness)" },
  { key: "hunger", color: "var(--color-need-hunger)" },
  { key: "energy", color: "var(--color-need-energy)" },
  { key: "affection", color: "var(--color-need-bond)" },
];

/** The row used by Party, PC and Neighborhood: ball, name, level, mood, four slim bars. */
export function PokemonCard({ view, active, onClick, aside, selected, compact }: { view: PokemonView; active?: boolean; onClick?: () => void; aside?: ReactNode; selected?: boolean; compact?: boolean }) {
  const g = genderGlyph(view.gender);
  const body = (
    <>
      <div className="relative">
        <PixelIcon name="pokeball" size={compact ? 32 : 44} className={view.state.asleep ? "opacity-60" : ""} />
        {active ? <span className="absolute -right-1 -top-1 rounded-sm bg-need-happiness px-1 font-pixel text-[9px] text-black">ON</span> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-extrabold leading-tight">{view.name}</span>
          <span className={`text-sm ${g.className}`} aria-label={g.label}>
            {g.glyph}
          </span>
          <span className="ml-auto font-pixel text-xs text-ink-dim">Lv. {view.level}</span>
        </div>
        <span className="truncate text-xs text-ink-dim">
          {titleCase(view.species)} - {view.state.asleep ? "asleep" : (MOOD_FACE[view.mood.label] ?? view.mood.label)}
        </span>
        {!compact ? (
          <div className="mt-1 flex items-center gap-2">
            <Hearts health={view.needs.health} size={12} />
            <div className="flex flex-1 gap-1">
              {NEEDS.map((n) => (
                <div key={n.key} className="meter h-1.5 flex-1" style={{ ["--meter-color" as string]: n.color }} aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, view.needs[n.key]))}%` }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {aside}
    </>
  );
  const cls = `card flex w-full items-center gap-3 px-3 py-2.5 text-left ${selected ? "ring-2 ring-need-happiness" : ""} ${onClick ? "hover:bg-white/10 active:scale-[0.99]" : ""}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
