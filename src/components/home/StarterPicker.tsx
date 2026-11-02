"use client";

import { useEffect, useMemo, useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Sheet } from "@/components/ui/Sheet";
import { Button, Skeleton, TypeBadge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, post, type PokemonView } from "@/components/lib/api";
import { titleCase } from "@/components/lib/format";
import type { StarterSpecies } from "@/lib/services/pokedex";

/** Classic picks shown before the trainer searches the full list. */
const FEATURED = [
  "eevee", "pikachu", "bulbasaur", "charmander", "squirtle", "chikorita", "cyndaquil", "totodile",
  "treecko", "torchic", "mudkip", "turtwig", "chimchar", "piplup", "snivy", "tepig", "oshawott",
  "chespin", "fennekin", "froakie", "rowlet", "litten", "popplio", "grookey", "scorbunny", "sobble",
  "sprigatito", "fuecoco", "quaxly", "riolu", "togepi", "mareep",
];

interface Props {
  open: boolean;
  onPicked: (view: PokemonView) => void;
  /** The X and the backdrop. Home shows an empty-state card that reopens it. */
  onClose: () => void;
}

export function StarterPicker({ open, onPicked, onClose }: Props) {
  const { toast } = useToast();
  const [all, setAll] = useState<StarterSpecies[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    get<{ species: StarterSpecies[] }>("/api/starter")
      .then((r) => setAll(r.species))
      .catch((e) => toast(errorText(e), "error"));
  }, [open, toast]);

  const byId = useMemo(() => new Map((all ?? []).map((s) => [s.id, s])), [all]);

  // The route carries names and types, so the grid needs no further requests.
  const shown = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!q) return FEATURED.map((id) => byId.get(id)).filter((s): s is StarterSpecies => !!s);
    const plain = q.replace(/_/g, " ");
    return all.filter((s) => s.id.includes(q) || s.name.toLowerCase().includes(plain) || String(s.dex) === q).slice(0, 36);
  }, [all, byId, query]);

  const chosenName = chosen ? (byId.get(chosen)?.name ?? titleCase(chosen)) : null;

  const pick = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await post<{ pokemon: PokemonView }>("/api/starter", { species: chosen, nickname: nickname.trim() || undefined });
      onPicked(r.pokemon);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Who will it be?" dim tall footer={<Footer nickname={nickname} setNickname={setNickname} chosenName={chosenName} busy={busy} pick={() => void pick()} />}>
      <p className="mb-3 text-sm text-ink-dim">Pick one that feels like a friend. It will live in the meadow and wait for you. Any species you can think of is in the search.</p>
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
            const selected = chosen === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setChosen(s.id)}
                  className={`flex h-full w-full flex-col items-center gap-1.5 rounded-[12px] px-2 py-3 text-center transition ${selected ? "bg-need-happiness/25 ring-2 ring-need-happiness" : "bg-white/8 hover:bg-white/14"}`}
                >
                  <StarterFace s={s} />
                  <span className="text-sm font-bold leading-tight">{s.name}</span>
                  <span className="flex flex-wrap justify-center gap-1">
                    {s.types.map((t) => (
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

/** The species' portrait from the render audit, or the ball when the install has none for it. */
function StarterFace({ s }: { s: StarterSpecies }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="flex h-11 w-11 items-center justify-center">
        <PixelIcon name="pokeball" size={28} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- portraits come from the data volume, not next/image.
    <img src={`/api/assets/portraits/${s.id}`} alt="" width={44} height={44} loading="lazy" decoding="async" onError={() => setBroken(true)} className="h-11 w-11 rounded-lg bg-white/10 object-cover" />
  );
}

function Footer({ nickname, setNickname, chosenName, busy, pick }: { nickname: string; setNickname: (v: string) => void; chosenName: string | null; busy: boolean; pick: () => void }) {
  return (
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="w-20 font-bold">Name</span>
          <input
            type="text"
            value={nickname}
            maxLength={12}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="optional, up to 12 letters"
            className="h-11 flex-1 rounded-[10px] bg-white/10 px-3 text-base outline-none ring-white/30 placeholder:text-ink-faint focus:ring-2"
          />
        </label>
        <Button variant="primary" disabled={!chosenName || busy} onClick={pick} className="h-12 text-base">
          {busy ? "Hatching..." : chosenName ? `Choose ${chosenName}` : "Pick a pokemon"}
        </Button>
      </div>
  );
}
