"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PokemonCard } from "@/components/ui/PokemonCard";
import { Sheet } from "@/components/ui/Sheet";
import { Button, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { downloadFile, errorText, get, post, type BoxView, type ImportResult, type PartyView, type PokemonView } from "@/components/lib/api";
import { titleCase } from "@/components/lib/format";

interface Boxes {
  boxSize: number;
  boxes: BoxView[];
}

export default function PcPage() {
  const { toast } = useToast();
  const [boxes, setBoxes] = useState<Boxes | null>(null);
  const [party, setParty] = useState<PartyView | null>(null);
  const [box, setBox] = useState(1);
  const [selected, setSelected] = useState<PokemonView | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      Promise.all([get<Boxes>("/api/pc"), get<PartyView>("/api/party")])
        .then(([b, p]) => {
          setBoxes(b);
          setParty(p);
        })
        .catch((e) => toast(errorText(e), "error")),
    [toast],
  );
  useEffect(() => {
    load();
  }, [load]);

  const current = useMemo(() => boxes?.boxes.find((b) => b.box === box) ?? { box, size: boxes?.boxSize ?? 30, pokemon: [] }, [boxes, box]);
  const boxCount = Math.max(boxes?.boxes.length ?? 1, box) + 1;

  const op = async (body: { op: "deposit" | "withdraw" | "release"; pokemonId: string; box?: number }) => {
    if (busy) return;
    setBusy(true);
    try {
      setBoxes(await post<Boxes>("/api/pc", body));
      setParty(await get<PartyView>("/api/party"));
      setSelected(null);
      setConfirmRelease(false);
      toast(body.op === "deposit" ? "Deposited" : body.op === "withdraw" ? "Back in the party" : "Released", body.op === "release" ? "info" : "success");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const exportAs = async (id: string, mode: "backup" | "trade") => {
    if (busy) return;
    setBusy(true);
    try {
      const name = await downloadFile(`/api/pokemon/${id}/export?mode=${mode}`);
      toast(mode === "trade" ? `${name} is out for trade` : `Saved ${name}`, "success");
      if (mode === "trade") {
        await load();
        setSelected(null);
      }
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (f: File | undefined) => {
    if (!f || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/pokemon/import", { method: "POST", body: form });
      const body = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      setImported(body);
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const selectedInParty = !!selected && party?.party.some((p) => p.id === selected.id);
  const partyFull = (party?.party.length ?? 0) >= (party?.size ?? 6);

  return (
    <Screen wide>
      <PageHeader
        title="PC"
        aside={
          <>
            <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-[12px] bg-white/10 px-3 text-sm font-bold hover:bg-white/16">
              <PixelIcon name="bag" size={18} />
              Import .cpkmn
              <input ref={file} type="file" accept=".cpkmn,application/vnd.gotcha.cpkmn,application/zip" className="sr-only" onChange={(e) => void onImport(e.target.files?.[0])} />
            </label>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-[1fr_320px]">
        <section className="card p-3" aria-labelledby="box-title">
          <div className="mb-3 flex items-center gap-2">
            <button type="button" aria-label="Previous box" disabled={box <= 1} onClick={() => setBox((b) => b - 1)} className="flex items-center justify-center rounded-lg hover:bg-white/10">
              <PixelIcon name="arrowLeft" size={18} />
            </button>
            <h2 id="box-title" className="flex-1 text-center font-pixel text-base">
              Box {box} <span className="text-ink-dim">{current.pokemon.length}/{current.size}</span>
            </h2>
            <button type="button" aria-label="Next box" disabled={box >= boxCount} onClick={() => setBox((b) => b + 1)} className="flex items-center justify-center rounded-lg hover:bg-white/10">
              <PixelIcon name="arrowRight" size={18} />
            </button>
          </div>
          {!boxes ? (
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 30 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-6 gap-1.5" aria-label={`Box ${box} slots`}>
              {Array.from({ length: current.size }).map((_, i) => {
                const p = current.pokemon.find((x) => x.boxSlot === i + 1);
                return (
                  <li key={i}>
                    {p ? (
                      <button
                        type="button"
                        onClick={() => setSelected(p)}
                        aria-label={`${p.name}, level ${p.level}`}
                        className="flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-[10px] bg-white/10 hover:bg-white/16"
                      >
                        <PixelIcon name="pokeball" size={28} />
                        <span className="w-full truncate px-1 text-center text-[10px] font-bold">{p.name}</span>
                      </button>
                    ) : (
                      <div className="aspect-square rounded-[10px] bg-white/4" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="party-title">
          <h2 id="party-title" className="font-pixel text-sm text-ink-dim">
            Party
          </h2>
          {!party ? (
            <Skeleton className="h-16" />
          ) : party.party.length === 0 ? (
            <EmptyState title="Party is empty" text="Withdraw a pokemon from a box to bring it home." />
          ) : (
            party.party.map((p) => <PokemonCard key={p.id} view={p} compact active={p.id === party.activeId} onClick={() => setSelected(p)} />)
          )}
        </section>
      </div>

      <Sheet open={!!selected} onClose={() => { setSelected(null); setConfirmRelease(false); }} title={selected?.name ?? ""} dim>
        {selected ? (
          <div className="flex flex-col gap-3">
            <PokemonCard view={selected} />
            <p className="text-xs text-ink-dim">
              {titleCase(selected.species)} - {selected.status === "pc" ? `Box ${selected.box}, slot ${selected.boxSlot}` : selectedInParty ? "in the party" : selected.status}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {selected.status === "pc" ? (
                <Button variant="primary" disabled={busy || partyFull} onClick={() => void op({ op: "withdraw", pokemonId: selected.id })}>
                  Withdraw
                </Button>
              ) : (
                <Button variant="primary" disabled={busy} onClick={() => void op({ op: "deposit", pokemonId: selected.id, box })}>
                  Deposit to box {box}
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => void exportAs(selected.id, "backup")}>
                Export backup
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void exportAs(selected.id, "trade")}>
                Export for trade
              </Button>
              {confirmRelease ? (
                <Button variant="danger" disabled={busy} onClick={() => void op({ op: "release", pokemonId: selected.id })}>
                  Really release
                </Button>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmRelease(true)}>
                  Release
                </Button>
              )}
            </div>
            {partyFull && selected.status === "pc" ? <p className="text-xs text-need-hunger">The party is full. Deposit one first.</p> : null}
            <p className="text-xs text-ink-faint">A trade export locks this pokemon until the file comes back through Import.</p>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={!!imported} onClose={() => setImported(null)} title="Import result" dim>
        {imported ? (
          <div className="flex flex-col gap-3">
            <PokemonCard view={imported.view} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-dim">Outcome</dt>
              <dd className="font-bold">{imported.outcome.replace(/_/g, " ")}</dd>
              <dt className="text-ink-dim">Signature</dt>
              <dd className={`font-bold ${imported.verification === "verified" ? "text-need-happiness" : "text-need-hunger"}`}>{imported.verification}</dd>
              {imported.bytesAwarded ? (
                <>
                  <dt className="text-ink-dim">Bytes</dt>
                  <dd className="font-pixel text-bytes">+{imported.bytesAwarded}</dd>
                </>
              ) : null}
            </dl>
            {imported.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-[10px] bg-white/6 p-2 text-xs">
                {imported.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <PixelIcon name="warn" size={14} className="shrink-0 text-need-hunger" />
                    <span>
                      <b>{w.code}</b> {"message" in w && typeof w.message === "string" ? w.message : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button variant="primary" onClick={() => setImported(null)}>
              Done
            </Button>
          </div>
        ) : null}
      </Sheet>
    </Screen>
  );
}
