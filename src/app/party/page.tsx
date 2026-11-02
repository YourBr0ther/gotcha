"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PokemonCard } from "@/components/ui/PokemonCard";
import { EmptyState, PageHeader, SkeletonCard } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, put, type PartyView } from "@/components/lib/api";

export default function PartyPage() {
  const { toast } = useToast();
  const [party, setParty] = useState<PartyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(() => get<PartyView>("/api/party").then(setParty).catch((e) => toast(errorText(e), "error")), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const update = async (body: { order?: string[]; activeId?: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      setParty(await put<PartyView>("/api/party", body));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const move = (from: number, to: number) => {
    if (!party || to < 0 || to >= party.party.length || from === to) return;
    const ids = party.party.map((p) => p.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    void update({ order: ids });
  };

  const slots = Array.from({ length: party?.size ?? 6 });

  return (
    <Screen>
      <PageHeader title="Party" aside={party ? <span className="font-pixel text-sm text-ink-dim">{party.party.length}/{party.size}</span> : null} />
      {!party ? (
        <div className="flex flex-col gap-2">
          {slots.map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : party.party.length === 0 ? (
        <EmptyState
          title="No pokemon yet"
          text="Pick a starter on the Home screen and it will show up here."
          action={
            <Link href="/" className="tap inline-flex items-center rounded-[12px] bg-need-happiness px-4 font-bold text-black">
              Go home
            </Link>
          }
        />
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Party slots">
          {slots.map((_, i) => {
            const p = party.party[i];
            if (!p) {
              return (
                <li key={`empty-${i}`} className="card flex items-center gap-3 border-dashed px-3 py-3 opacity-60" aria-label={`Slot ${i + 1}, empty`}>
                  <PixelIcon name="pokeball" size={32} className="opacity-40" />
                  <span className="text-sm text-ink-dim">Slot {i + 1}</span>
                </li>
              );
            }
            const active = p.id === party.activeId;
            return (
              <li
                key={p.id}
                draggable
                onDragStart={() => setDragging(p.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragging) return;
                  const from = party.party.findIndex((x) => x.id === dragging);
                  setDragging(null);
                  move(from, i);
                }}
                onDragEnd={() => setDragging(null)}
                className={dragging === p.id ? "opacity-50" : ""}
              >
                {/* The row is a tap target for "make active"; the arrows are real buttons beside it, never nested. */}
                <div className="relative" onClick={() => !active && void update({ activeId: p.id })}>
                  <PokemonCard
                    view={p}
                    active={active}
                    selected={active}
                    aside={
                      <span className="flex flex-col" onClick={(e) => e.stopPropagation()} role="presentation">
                        {!active ? (
                          <button type="button" className="sr-only" onClick={() => void update({ activeId: p.id })}>
                            Make {p.name} active
                          </button>
                        ) : null}
                        <button type="button" aria-label={`Move ${p.name} up`} disabled={busy || i === 0} onClick={() => move(i, i - 1)} className="flex h-9 w-10 items-center justify-center rounded-md text-ink-dim hover:bg-white/10" style={{ minHeight: 36 }}>
                          <PixelIcon name="arrowLeft" size={16} style={{ transform: "rotate(90deg)" }} />
                        </button>
                        <button type="button" aria-label={`Move ${p.name} down`} disabled={busy || i === party.party.length - 1} onClick={() => move(i, i + 1)} className="flex h-9 w-10 items-center justify-center rounded-md text-ink-dim hover:bg-white/10" style={{ minHeight: 36 }}>
                          <PixelIcon name="arrowRight" size={16} style={{ transform: "rotate(90deg)" }} />
                        </button>
                      </span>
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-center text-xs text-ink-faint">Tap a pokemon to bring it home. The arrows change the order.</p>
    </Screen>
  );
}
