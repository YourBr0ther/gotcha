"use client";

import { useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, type PartyView, type PokemonView } from "@/components/lib/api";
import { relativeTime } from "@/components/lib/format";
import { markRead } from "@/components/home/journalMark";
import type { JournalView } from "@/lib/services/journal";

interface Loaded {
  pokemon: PokemonView;
  journal: JournalView;
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
  const name = loaded?.pokemon.name;
  // The nightly roll-up appends its own row to the memories too; the diary section shows it dated, so skip it here.
  const episodic = journal ? journal.episodic.filter((e) => !e.summary.startsWith("Journal,")) : [];

  return (
    <Screen>
      <PageHeader title={name ? `${name}'s journal` : "Journal"} back="/more" />
      {loaded === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : loaded === null || !journal ? (
        <EmptyState title="No pokemon at home" text="The journal belongs to whoever is active in your party." />
      ) : (
        <>
          <section className="card p-4" aria-labelledby="summary-title">
            <h2 id="summary-title" className="mb-1 font-pixel text-xs uppercase tracking-wider text-ink-dim">
              So far
            </h2>
            <p className="font-pixel text-sm leading-relaxed">{journal.summary || `${name} has not written anything yet. The first page comes after the nightly roll-up.`}</p>
          </section>
          {journal.journalEntries.length > 0 ? (
            <section aria-labelledby="diary-title" className="flex flex-col gap-2">
              <h2 id="diary-title" className="font-pixel text-xs uppercase tracking-wider text-ink-dim">
                Diary
              </h2>
              <ol className="flex flex-col gap-2" aria-label="Diary entries">
                {journal.journalEntries.map((e) => (
                  <li key={e.id} className="card flex gap-3 px-3 py-3">
                    <PixelIcon name="book" size={28} className="shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="text-sm">{e.summary.replace(/^Journal,\s*/, "")}</p>
                      <span className="font-pixel text-[10px] text-ink-faint">
                        {relativeTime(e.ts)}
                        {e.emotion ? ` - ${e.emotion}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {episodic.length === 0 ? (
            <EmptyState title="No entries yet" text="Feed, play and talk; the day's events show up here after the nightly roll-up." />
          ) : (
            <section aria-labelledby="memories-title" className="flex flex-col gap-2">
              <h2 id="memories-title" className="font-pixel text-xs uppercase tracking-wider text-ink-dim">
                Memories
              </h2>
              <ol className="flex flex-col gap-2" aria-label="Entries">
                {episodic.map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="card flex gap-3 px-3 py-3">
                    <PixelIcon name={e.kind === "play" ? "pokeball" : e.kind === "care" ? "apple" : e.kind === "talk" ? "mic" : e.kind === "milestone" ? "bytes" : "book"} size={28} className="shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="text-sm">{e.summary}</p>
                      <span className="font-pixel text-[10px] text-ink-faint">
                        {relativeTime(e.ts)}
                        {e.emotion ? ` - ${e.emotion}` : ""}
                        {e.importance >= 4 ? " - big day" : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </Screen>
  );
}
