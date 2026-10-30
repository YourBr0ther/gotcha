"use client";

import { useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { EmptyState, PageHeader, SkeletonCard, TypeBadge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, type RichView } from "@/components/lib/api";
import { titleCase } from "@/components/lib/format";

interface Entry {
  species: string;
  nationalDex: number;
  types: string[];
  lines: string[];
  owned: string[];
}

interface DexJson {
  lines?: Record<string, string>;
}

interface SpeciesJson {
  primaryType?: string;
  secondaryType?: string;
}

/** Flavour text from the view's pokedex member when the API sends it; the extracted cache otherwise. */
async function fillFromCache(entry: Entry): Promise<Entry> {
  if (entry.lines.length > 0 && entry.types.length > 0) return entry;
  try {
    const [dex, species] = await Promise.all([
      fetch(`/api/assets/${entry.species}/dex.json`).then((r) => (r.ok ? (r.json() as Promise<DexJson>) : null)),
      fetch(`/api/assets/${entry.species}/species.json`).then((r) => (r.ok ? (r.json() as Promise<SpeciesJson>) : null)),
    ]);
    // The base form's line first, then forms (gmax and the like).
    const base = `cobblemon.species.${entry.species}.desc`;
    const fromCache = Object.entries(dex?.lines ?? {})
      .filter(([k]) => k.endsWith(".desc"))
      .sort(([a], [b]) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)))
      .map(([, v]) => v);
    const lines = entry.lines.length > 0 ? entry.lines : fromCache;
    const types = entry.types.length > 0 ? entry.types : [species?.primaryType, species?.secondaryType].filter((t): t is string => !!t);
    return { ...entry, lines, types };
  } catch {
    return entry;
  }
}

export default function PokedexPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    get<{ pokemon: RichView[] }>("/api/pokemon")
      .then(async (r) => {
        const bySpecies = new Map<string, Entry>();
        for (const p of r.pokemon) {
          const e = bySpecies.get(p.species) ?? {
            species: p.species,
            nationalDex: p.nationalDex,
            types: p.pokedex?.types ?? [],
            lines: [...(p.pokedex?.flavorTexts ?? []), ...(p.pokedex?.cobblemonPokedexLines ?? [])],
            owned: [],
          };
          e.owned.push(p.name);
          bySpecies.set(p.species, e);
        }
        const filled = await Promise.all([...bySpecies.values()].sort((a, b) => a.nationalDex - b.nationalDex).map(fillFromCache));
        setEntries(filled);
      })
      .catch((e) => toast(errorText(e), "error"));
  }, [toast]);

  return (
    <Screen>
      <PageHeader title="Pokedex" back="/more" aside={entries ? <span className="font-pixel text-sm text-ink-dim">{entries.length} seen</span> : null} />
      {!entries ? (
        <div className="flex flex-col gap-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title="Nothing seen yet" text="Species you raise or import appear here with their Pokedex entries." />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.species} className="card flex gap-3 px-3 py-3">
              <PixelIcon name="pokeball" size={40} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-pixel text-xs text-ink-dim">#{String(e.nationalDex).padStart(3, "0")}</span>
                  <span className="text-base font-extrabold">{titleCase(e.species)}</span>
                  <span className="ml-auto flex gap-1">
                    {e.types.map((t) => (
                      <TypeBadge key={t} type={t} />
                    ))}
                  </span>
                </div>
                {e.lines.length > 0 ? <p className="text-sm text-ink-dim">{e.lines[0]}</p> : <p className="text-xs text-ink-faint">No entry on file.</p>}
                <span className="text-[11px] text-ink-faint">Yours: {e.owned.join(", ")}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
