"use client";

import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Button } from "@/components/ui/primitives";
import { titleCase } from "@/components/lib/format";
import type { BagEntry, PokemonView, StoreItem } from "@/components/lib/api";

interface Props {
  view: PokemonView;
  bag: BagEntry[];
  catalog: StoreItem[];
  busy: boolean;
  onEvolve: (to: string) => void;
  onDecline: (forever: boolean) => void;
}

/**
 * The ask. A pokemon that could evolve says so here, one card above the
 * action row, and the trainer answers: evolve, not now, or never. A stone
 * evolution the bag cannot pay for shows what it needs instead of a button.
 */
export function EvolutionPrompt({ view, bag, catalog, busy, onEvolve, onDecline }: Props) {
  const inBag = new Set(bag.filter((b) => b.qty > 0).map((b) => b.itemId));
  // Only what can happen right now is worth a card: a stone evolution waits in the store until the stone is in the bag.
  const options = view.evolution.options.filter((o) => (o.trigger === "item" ? !!o.item && inBag.has(o.item) : o.trigger === "trade" ? inBag.has("link_cable") : true));
  if (options.length === 0) return null;
  const itemName = (id: string) => catalog.find((i) => i.id === id)?.name ?? titleCase(id);
  return (
    <div className="card card-strong w-full max-w-lg px-4 py-3" role="dialog" aria-label={`${view.name} could evolve`}>
      <div className="flex items-center gap-2">
        <span className="bob">
          <PixelIcon name="hygiene" size={22} />
        </span>
        <span className="font-pixel text-[13px] leading-snug">{view.name} is glowing. {options.length === 1 ? `Evolve into ${titleCase(options[0].to)}?` : "Which way should it go?"}</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {options.map((o) => (
          <div key={o.to} className="flex items-center gap-2">
            <span className="flex-1 text-sm font-bold">
              {titleCase(o.to)}
              {o.trigger === "item" && o.item ? <span className="ml-2 font-pixel text-[11px] text-ink-dim">uses the {itemName(o.item)}</span> : null}
            </span>
            <Button onClick={() => onEvolve(o.to)} disabled={busy}>
              Evolve
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDecline(false)} disabled={busy}>
          Not now
        </Button>
        <Button variant="ghost" onClick={() => onDecline(true)} disabled={busy}>
          Never
        </Button>
      </div>
    </div>
  );
}
