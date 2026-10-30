"use client";

import { useEffect, useMemo, useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Sheet } from "@/components/ui/Sheet";
import { Button, Skeleton, TypeBadge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, post, type PokemonView } from "@/components/lib/api";
import { titleCase } from "@/components/lib/format";

/** Classic picks shown before the trainer searches the full list. */
const FEATURED = [
  "eevee", "pikachu", "bulbasaur", "charmander", "squirtle", "chikorita", "cyndaquil", "totodile",
  "treecko", "torchic", "mudkip", "turtwig", "chimchar", "piplup", "snivy", "tepig", "oshawott",
  "chespin", "fennekin", "froakie", "rowlet", "litten", "popplio", "grookey", "scorbunny", "sobble",
  "sprigatito", "fuecoco", "quaxly", "riolu", "togepi", "mareep",
];

interface SpeciesJson {
  primaryType?: string;
  secondaryType?: string;
}

interface Props {
  open: boolean;
  onPicked: (view: PokemonView) => void;
}

export function StarterPicker({ open, onPicked }: Props) {
  const { toast } = useToast();
  const [all, setAll] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<Record<string, string[]>>({});
  const [chosen, setChosen] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    get<{ species: string[] }>("/api/starter")
      .then((r) => setAll(r.species))
      .catch((e) => toast(errorText(e), "error"));
  }, [open, toast]);

  const shown = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!q) return FEATURED.filter((s) => all.includes(s));
    return all.filter((s) => s.includes(q)).slice(0, 36);
  }, [all, query]);

  // Types come from the extracted species file; the starter route only lists ids.
  useEffect(() => {
    let alive = true;
    const missing = shown.filter((s) => !(s in types));
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (s): Promise<[string, string[]]> => {
        try {
          const res = await fetch(`/api/assets/${s}/species.json`);
          if (!res.ok) return [s, []];
          const json = (await res.json()) as SpeciesJson;
          return [s, [json.primaryType, json.secondaryType].filter((t): t is string => !!t)];
        } catch {
          return [s, []];
        }
      }),
    ).then((pairs) => {
      if (!alive) return;
      setTypes((prev) => {
        const next = { ...prev };
        for (const [s, t] of pairs) next[s] = t;
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [shown, types]);

  const pick = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await post<{ pokemon: PokemonView }>("/api/starter", { species: chosen, nickname: nickname.trim() || undefined });
      toast(`${r.pokemon.name} is yours`, "success");
      onPicked(r.pokemon);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => undefined} title="Choose your first pokemon" dim footer={<Footer nickname={nickname} setNickname={setNickname} chosen={chosen} busy={busy} pick={() => void pick()} />}>
      <p className="mb-3 text-sm text-ink-dim">It will live in the meadow and wait for you. Pick one that feels like a friend.</p>
      <label className="mb-3 block">
        <span className="sr-only">Search species</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all species"
          className="h-11 w-full rounded-[10px] bg-white/10 px-3 text-base outline-none ring-white/30 placeholder:text-ink-faint focus:ring-2"
          autoComplete="off"
        />
      </label>
      {!all ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-dim">No species matches that.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label="Species">
          {shown.map((s) => {
            const selected = chosen === s;
            return (
              <li key={s}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setChosen(s)}
                  className={`flex h-full w-full flex-col items-center gap-1.5 rounded-[12px] px-2 py-3 text-center transition ${selected ? "bg-need-happiness/25 ring-2 ring-need-happiness" : "bg-white/8 hover:bg-white/14"}`}
                >
                  <PixelIcon name="pokeball" size={28} />
                  <span className="text-sm font-bold leading-tight">{titleCase(s)}</span>
                  <span className="flex flex-wrap justify-center gap-1">
                    {(types[s] ?? []).map((t) => (
                      <TypeBadge key={t} type={t} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

function Footer({ nickname, setNickname, chosen, busy, pick }: { nickname: string; setNickname: (v: string) => void; chosen: string | null; busy: boolean; pick: () => void }) {
  return (
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="w-20 font-bold">Nickname</span>
          <input
            type="text"
            value={nickname}
            maxLength={12}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="optional"
            className="h-11 flex-1 rounded-[10px] bg-white/10 px-3 text-base outline-none ring-white/30 placeholder:text-ink-faint focus:ring-2"
          />
        </label>
        <Button variant="primary" disabled={!chosen || busy} onClick={pick} className="h-12 text-base">
          {busy ? "Hatching..." : chosen ? `Choose ${titleCase(chosen)}` : "Pick a pokemon"}
        </Button>
      </div>
  );
}
