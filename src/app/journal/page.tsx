"use client";

import { useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, type PartyView, type RichView } from "@/components/lib/api";
import { relativeTime } from "@/components/lib/format";
import { markRead } from "@/components/lib/journalBadge";

export default function JournalPage() {
  const { toast } = useToast();
  const [view, setView] = useState<RichView | null | undefined>(undefined);

  useEffect(() => {
    get<PartyView>("/api/party")
      .then(async (party) => {
        const active = party.party.find((p) => p.id === party.activeId) ?? party.party[0];
        if (!active) {
          setView(null);
          return;
        }
        const full = await get<RichView>(`/api/pokemon/${active.id}`);
        setView(full);
        markRead(full.id, full.memories);
      })
      .catch((e) => toast(errorText(e), "error"));
  }, [toast]);

  const memories = view?.memories;
  const episodic = memories ? [...memories.episodic].sort((a, b) => (a.ts < b.ts ? 1 : -1)) : [];

  return (
    <Screen>
      <PageHeader title={view ? `${view.name}'s journal` : "Journal"} back="/more" />
      {view === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : view === null ? (
        <EmptyState title="No pokemon at home" text="The journal belongs to whoever is active in your party." />
      ) : !memories ? (
        <EmptyState title="The pages are blank" text={`${view.name} will start writing once the nightly roll-up runs and the API sends memories along with the view.`} />
      ) : (
        <>
          <section className="card p-4" aria-labelledby="summary-title">
            <h2 id="summary-title" className="mb-1 font-pixel text-xs uppercase tracking-wider text-ink-dim">
              So far
            </h2>
            <p className="font-pixel text-sm leading-relaxed">{memories.summary || "Nothing written yet."}</p>
          </section>
          {episodic.length === 0 ? (
            <EmptyState title="No entries yet" text="Feed, play and talk; the day's events show up here." />
          ) : (
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
          )}
        </>
      )}
    </Screen>
  );
}
