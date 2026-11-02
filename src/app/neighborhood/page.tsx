"use client";

import { useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Face } from "@/components/ui/Face";
import { EmptyState, PageHeader, SkeletonCard } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, type TrainerSummary } from "@/components/lib/api";
import { MOOD_FACE, sentence, titleCase } from "@/components/lib/format";

export default function NeighborhoodPage() {
  const { toast } = useToast();
  const [trainers, setTrainers] = useState<TrainerSummary[] | null>(null);

  useEffect(() => {
    get<{ trainers: TrainerSummary[] }>("/api/trainers")
      .then((r) => setTrainers(r.trainers))
      .catch((e) => toast(errorText(e), "error"));
  }, [toast]);

  return (
    <Screen>
      <PageHeader title="Neighborhood" back="/" />
      {!trainers ? (
        <div className="flex flex-col gap-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : trainers.length === 0 ? (
        <EmptyState title="Nobody else yet" text="Everyone in the family shows up here after their first visit." />
      ) : (
        <ul className="flex flex-col gap-2">
          {trainers.map((t) => (
            <li key={t.id} className="card flex items-center gap-3 px-3 py-3">
              {t.activePokemon ? <Face species={t.activePokemon.species} size={48} /> : <PixelIcon name="pokeball" size={40} className="opacity-40" />}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-base font-extrabold">{t.name}</span>
                  {t.username.toLowerCase() !== t.name.toLowerCase() ? <span className="font-pixel text-[10px] text-ink-faint">@{t.username}</span> : null}
                </span>
                {t.activePokemon ? (
                  <>
                    <span className="text-xs text-ink-dim">
                      {t.activePokemon.name} the {titleCase(t.activePokemon.species)}, Lv. {t.activePokemon.level}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {t.activePokemon.asleep ? "Asleep" : sentence(MOOD_FACE[t.activePokemon.mood] ?? t.activePokemon.mood)} in the {t.activePokemon.diorama}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">No pokemon at home</span>
                )}
              </div>
              {t.activePokemon?.asleep ? <PixelIcon name="energy" size={20} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
