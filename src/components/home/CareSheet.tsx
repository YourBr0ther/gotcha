"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { Sheet } from "@/components/ui/Sheet";
import { Button, Meter } from "@/components/ui/primitives";
import type { BagEntry, CareAction, PokemonView, StoreItem } from "@/components/lib/api";
import { CATEGORY_LABEL, CATEGORY_ORDER, describeEffects, itemAction, itemGlyph } from "@/components/lib/items";

export type CareKind = "feed" | "play" | "groom" | "rest" | "items";

export interface CareRequest {
  action: CareAction;
  item?: string;
}

interface Props {
  kind: CareKind | null;
  onClose: () => void;
  view: PokemonView;
  bag: BagEntry[];
  catalog: StoreItem[];
  busy: boolean;
  onCare: (req: CareRequest) => void;
  onDiscard: (itemId: string) => void;
}

const TITLES: Record<CareKind, string> = { feed: "Feed", play: "Play", groom: "Groom", rest: "Rest", items: "Bag" };

function ItemRow({ item, qty, actionLabel, onUse, onDiscard, busy }: { item: StoreItem; qty: number; actionLabel: string | null; onUse?: () => void; onDiscard?: () => void; busy: boolean }) {
  const glyph = itemGlyph(item);
  return (
    <li className="flex items-center gap-3 rounded-[12px] bg-white/6 px-3 py-2">
      <PixelIcon name={glyph.name} tint={glyph.tint} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold">
          {item.name} <span className="font-pixel text-xs text-ink-dim">x{qty}</span>
        </span>
        <span className="truncate text-xs text-ink-dim">{describeEffects(item)}</span>
      </div>
      {onDiscard ? (
        <Button variant="ghost" onClick={onDiscard} disabled={busy} aria-label={`Discard ${item.name}`} className="px-3">
          Toss
        </Button>
      ) : null}
      {onUse && actionLabel ? (
        <Button variant="primary" onClick={onUse} disabled={busy} className="px-3">
          {actionLabel}
        </Button>
      ) : null}
    </li>
  );
}

function FreeRow({ icon, title, text, label, onClick, busy, danger }: { icon: PixelIconName; title: string; text: string; label: string; onClick: () => void; busy: boolean; danger?: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-[12px] bg-white/6 px-3 py-2">
      <PixelIcon name={icon} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold">{title}</span>
        <span className="text-xs text-ink-dim">{text}</span>
      </div>
      <Button variant={danger ? "danger" : "primary"} onClick={onClick} disabled={busy} className="px-3">
        {label}
      </Button>
    </li>
  );
}

/** A row that leads to another screen: the store from Bag, the games from Play. */
function LinkRow({ icon, title, text, href, label }: { icon: PixelIconName; title: string; text: string; href: string; label: string }) {
  return (
    <li className="flex items-center gap-3 rounded-[12px] bg-white/6 px-3 py-2">
      <PixelIcon name={icon} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold">{title}</span>
        <span className="text-xs text-ink-dim">{text}</span>
      </div>
      <Link href={href} className="tap inline-flex items-center justify-center rounded-[12px] bg-white/10 px-3 text-sm font-bold hover:bg-white/16">
        {label}
      </Link>
    </li>
  );
}

function StoreLink({ text }: { text: string }) {
  return <LinkRow icon="store" title="Store" text={text} href="/store" label="Shop" />;
}

export function CareSheet({ kind, onClose, view, bag, catalog, busy, onCare, onDiscard }: Props) {
  const byId = useMemo(() => new Map<string, StoreItem>(catalog.map((i) => [i.id, i])), [catalog]);
  const owned = useMemo(
    () => bag.map((b) => ({ entry: b, item: byId.get(b.itemId) })).filter((x): x is { entry: BagEntry; item: StoreItem } => !!x.item && x.entry.qty > 0),
    [bag, byId],
  );
  const asleep = view.state.asleep;
  const sick = !!view.state.sickness;

  if (!kind) return null;

  let body: React.ReactNode;
  switch (kind) {
    case "feed": {
      const food = owned.filter((o) => o.item.effects.fill?.hunger);
      body = (
        <>
          <Meter value={view.needs.hunger} color="var(--color-need-hunger)" label="Hunger" icon="hunger" compact />
          {asleep ? <p className="mt-2 text-xs text-ink-dim">{view.name} is asleep and will not eat right now.</p> : null}
          {view.needs.hunger >= 90 ? <p className="mt-2 text-xs text-need-hunger">Already full. Feeding now would be overfeeding.</p> : null}
          <ul className="mt-3 flex flex-col gap-2">
            {food.length === 0 ? <StoreLink text="No food in the bag." /> : null}
            {food.map(({ entry, item }) => (
              <ItemRow key={item.id} item={item} qty={entry.qty} actionLabel="Feed" busy={busy} onUse={() => onCare({ action: "feed", item: item.id })} />
            ))}
          </ul>
        </>
      );
      break;
    }
    case "play": {
      const toys = owned.filter((o) => o.item.category === "toy");
      body = (
        <>
          <Meter value={view.needs.fun} color="var(--color-need-happiness)" label="Happiness" icon="happy" compact />
          {view.needs.energy < 15 ? <p className="mt-2 text-xs text-need-energy">Too tired to enjoy it fully.</p> : null}
          {asleep ? <p className="mt-2 text-xs text-ink-dim">Waking {view.name} up to play counts as a care mistake.</p> : null}
          <ul className="mt-3 flex flex-col gap-2">
            <FreeRow icon="pokeball" title="Just play" text="A game of catch. Costs a little energy." label="Play" busy={busy} onClick={() => onCare({ action: "play" })} />
            {toys.map(({ entry, item }) => (
              <ItemRow key={item.id} item={item} qty={entry.qty} actionLabel="Play" busy={busy} onUse={() => onCare({ action: "play", item: item.id })} />
            ))}
            {toys.length === 0 ? <StoreLink text="Toys make play last longer." /> : null}
            <LinkRow icon="games" title="Mini-games" text="Berry Catch, Whack-a-Diglett, Type Match. They pay Bytes." href="/games" label="Play" />
          </ul>
        </>
      );
      break;
    }
    case "groom": {
      body = (
        <>
          <Meter value={view.needs.hygiene} color="var(--color-need-hygiene)" label="Hygiene" icon="hygiene" compact />
          <ul className="mt-3 flex flex-col gap-2">
            <FreeRow icon="brush" title="Brush" text="A good brushing cleans right up." label="Groom" busy={busy} onClick={() => onCare({ action: "groom" })} />
          </ul>
        </>
      );
      break;
    }
    case "rest": {
      const meds = owned.filter((o) => o.item.category === "medicine" || o.item.category === "potion");
      body = (
        <>
          <Meter value={view.needs.energy} color="var(--color-need-energy)" label="Energy" icon="energy" compact />
          <Meter value={view.needs.health} color="var(--color-need-health)" label="Health" icon="heart" compact />
          {sick ? <p className="mt-2 text-xs text-need-health">{view.name} is sick. Medicine or a long rest will clear it.</p> : null}
          <ul className="mt-3 flex flex-col gap-2">
            {asleep ? (
              <FreeRow
                icon="sun"
                title="Wake up"
                text={view.needs.energy < 80 ? "Still tired. Waking now is a care mistake." : "Rested and ready."}
                label="Wake"
                busy={busy}
                danger={view.needs.energy < 80}
                onClick={() => onCare({ action: "wake" })}
              />
            ) : (
              <FreeRow
                icon="pillow"
                title="Tuck in"
                text={view.needs.energy >= 90 ? "Not tired yet; it will refuse." : "Lights off. Energy comes back while sleeping."}
                label="Rest"
                busy={busy}
                onClick={() => onCare({ action: "rest" })}
              />
            )}
            {meds.map(({ entry, item }) => (
              <ItemRow key={item.id} item={item} qty={entry.qty} actionLabel="Give" busy={busy} onUse={() => onCare({ action: "medicine", item: item.id })} />
            ))}
            <FreeRow icon="warn" title="Discipline" text="Only after a mess. Unjust scolding costs bond." label="Scold" busy={busy} danger onClick={() => onCare({ action: "discipline" })} />
          </ul>
        </>
      );
      break;
    }
    case "items": {
      const groups = CATEGORY_ORDER.map((c) => ({ category: c, items: owned.filter((o) => o.item.category === c) })).filter((g) => g.items.length > 0);
      body = (
        <>
          <ul className="mb-3">
            <StoreLink text={groups.length === 0 ? "The bag is empty. Food, toys, medicine and places." : "Food, toys, medicine and places."} />
          </ul>
          {groups.map((g) => (
            <section key={g.category} className="mb-3">
              <h3 className="mb-1.5 font-pixel text-xs uppercase tracking-wider text-ink-dim">{CATEGORY_LABEL[g.category]}</h3>
              <ul className="flex flex-col gap-2">
                {g.items.map(({ entry, item }) => {
                  const action = itemAction(item);
                  const label = action === "feed" ? "Feed" : action === "play" ? "Play" : action === "medicine" ? "Give" : null;
                  return (
                    <ItemRow
                      key={item.id}
                      item={item}
                      qty={entry.qty}
                      actionLabel={label}
                      busy={busy}
                      onUse={action ? () => onCare({ action, item: item.id }) : undefined}
                      onDiscard={() => onDiscard(item.id)}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      );
      break;
    }
  }

  return (
    <Sheet open onClose={onClose} title={TITLES[kind]}>
      {body}
    </Sheet>
  );
}
