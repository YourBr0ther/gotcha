"use client";

import { useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, type PartyView, type PokemonView } from "@/components/lib/api";
import { markRead } from "@/components/home/journalMark";
import type { JournalDay, JournalMoment, JournalView } from "@/lib/services/journal";

interface Loaded {
  pokemon: PokemonView;
  journal: JournalView;
}

/** "Today", "Yesterday", then "Sat, Nov 1". The day is a local date; parsing it as one keeps the browser from shifting it a day. */
function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split("-").map(Number);
  const yesterday = new Date(ty, tm - 1, td - 1);
  if (date.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function clock(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

const KIND_ICON: Record<string, PixelIconName> = {
  care: "apple",
  play: "games",
  talk: "mic",
  milestone: "bytes",
  evolution: "stone",
  sickness: "medicine",
  neglect: "warn",
  trade: "pc",
  visit: "party",
  other: "book",
};

function Moment({ m }: { m: JournalMoment }) {
  return (
    <li className="flex items-center gap-2.5">
      <PixelIcon name={KIND_ICON[m.kind] ?? "book"} size={18} className="shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 text-sm leading-snug">
        {m.summary}
        {m.times > 1 ? <span className="text-ink-faint"> ×{m.times}</span> : null}
      </span>
      <span className="shrink-0 font-pixel text-[10px] text-ink-faint">{clock(m.ts)}</span>
    </li>
  );
}

function Day({ d, name, today }: { d: JournalDay; name: string; today: string }) {
  const isToday = d.day === today;
  return (
    <section className="card flex flex-col gap-3 px-4 py-3" aria-label={dayLabel(d.day, today)}>
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-pixel text-xs uppercase tracking-wider text-ink-dim">{dayLabel(d.day, today)}</h2>
        {d.feeling ? <span className="font-pixel text-[10px] text-ink-faint">felt {d.feeling}</span> : null}
      </header>
      {d.page ? (
        <p className="text-[15px] leading-relaxed">{d.page}</p>
      ) : isToday ? (
        <p className="text-sm italic text-ink-faint">{name} writes tonight&apos;s page after bedtime.</p>
      ) : null}
      {d.moments.length > 0 ? (
        <ol className="flex flex-col gap-1.5 border-t border-white/10 pt-2.5" aria-label="Moments">
          {d.moments.map((m, i) => (
            <Moment key={`${m.ts}-${i}`} m={m} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default function JournalPage() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    get<PartyView>("/api/party")
      .then(async (party) => {
        const active = party.party.find((p) => p.id === party.activeId) ?? party.party[0];
        if (!active) {
          setLoaded(null);
          return;
        }
        const journal = await get<JournalView>(`/api/pokemon/${active.id}/journal`);
        setLoaded({ pokemon: active, journal });
        markRead(active.id, journal.newestAt);
      })
      .catch((e) => toast(errorText(e), "error"));
  }, [toast]);

  const journal = loaded?.journal;
  const name = loaded?.pokemon.name ?? "";

  return (
    <Screen>
      <PageHeader title={name ? `${name}'s journal` : "Journal"} back="/" />
      {loaded === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : loaded === null || !journal ? (
        <EmptyState title="No pokemon at home" text="The journal belongs to whoever is active in your party." />
      ) : journal.days.length === 0 ? (
        <EmptyState title="Nothing written yet" text={`Feed, play and talk. ${name} writes a page every night about the day.`} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {journal.days.map((d) => (
              <Day key={d.day} d={d} name={name} today={journal.today} />
            ))}
          </div>
          {journal.summary ? (
            <details className="card px-4 py-3">
              <summary className="cursor-pointer font-pixel text-xs uppercase tracking-wider text-ink-dim">What {name} remembers</summary>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{journal.summary}</p>
            </details>
          ) : null}
        </>
      )}
    </Screen>
  );
}
