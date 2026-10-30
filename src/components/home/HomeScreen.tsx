"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, EmoteKind, WorldHandle, DioramaId } from "@/world/api";
import { isDioramaId, localHours } from "@/world/api";
import { loadSpeciesBundle } from "@/world/bundle";
import type { NeedName } from "@gotcha/cpkmn";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/primitives";
import { errorText, get, post, shareOrDownload, type BagEntry, type CareOutcome, type Me, type PartyView, type RichView, type StoreItem, type StoreResponse, type Weather } from "@/components/lib/api";
import { hasUnread } from "@/components/lib/journalBadge";
import { readLowPower } from "@/components/lib/prefs";
import { ActionButton, ClockCard, MetersCard, NameCard, SquareButton, type Deltas } from "./Hud";
import { CareSheet, type CareKind, type CareRequest } from "./CareSheet";
import { DialogueBox } from "./DialogueBox";
import { Microphone, type TalkReply } from "./Microphone";
import { StarterPicker } from "./StarterPicker";

const World = dynamic(() => import("@/world/World"), {
  ssr: false,
  loading: () => <WorldPlaceholder text="Waking up the meadow" />,
});

function WorldPlaceholder({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(180deg,#5fa8e0_0%,#87c9a2_45%,#3f7a3a_75%,#28491f_100%)]">
      <div className="card flex items-center gap-3 px-4 py-3">
        <span className="bob">
          <PixelIcon name="pokeball" size={28} />
        </span>
        <span className="font-pixel text-sm">{text}</span>
      </div>
    </div>
  );
}

const ACTIVITIES: readonly Activity[] = ["idle", "walk", "sleep", "swim", "float", "fly", "hover", "cry", "faint"];
const EMOTES: readonly EmoteKind[] = ["happy", "love", "sad", "angry", "question", "surprise", "sleepy", "music"];
const ACTIVITY_ALIASES: Record<string, Activity> = { sleeping: "sleep", nap: "sleep", wander: "walk", walking: "walk", explore: "walk", forage: "walk", swimming: "swim", flying: "fly" };

function toActivity(value: string | undefined): Activity | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if ((ACTIVITIES as readonly string[]).includes(v)) return v as Activity;
  return ACTIVITY_ALIASES[v] ?? null;
}

function toEmote(value: string | undefined): EmoteKind | null {
  if (!value) return null;
  const v = value.toLowerCase();
  return (EMOTES as readonly string[]).includes(v) ? (v as EmoteKind) : null;
}

function toDiorama(value: string | undefined): DioramaId {
  return value && isDioramaId(value) ? value : "meadow";
}

type Phase = "loading" | "starter" | "world" | "error";

export function HomeScreen() {
  const { toast } = useToast();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<RichView | null>(null);
  const [catalog, setCatalog] = useState<StoreItem[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [sheet, setSheet] = useState<CareKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [deltas, setDeltas] = useState<Deltas>({});
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [photo, setPhoto] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const handleRef = useRef<WorldHandle | null>(null);
  const handleWaiters = useRef<Array<(h: WorldHandle) => void>>([]);
  const worldBox = useRef<HTMLDivElement>(null);
  const lastPet = useRef(0);

  const onReady = useCallback((handle: WorldHandle) => {
    handleRef.current = handle;
    handle.setTimeOfDay(localHours());
    handle.setAmbient(!readLowPower());
    for (const w of handleWaiters.current.splice(0)) w(handle);
  }, []);

  const withHandle = useCallback((): Promise<WorldHandle> => {
    if (handleRef.current) return Promise.resolve(handleRef.current);
    return new Promise((resolve) => handleWaiters.current.push(resolve));
  }, []);

  // Trainer, party, catalog.
  useEffect(() => {
    Promise.all([get<Me>("/api/me"), get<PartyView>("/api/party"), get<StoreResponse>("/api/store")])
      .then(([meRes, party, store]) => {
        setMe(meRes);
        setCatalog(store.catalog);
        const active = party.party.find((p) => p.id === party.activeId) ?? party.party[0] ?? null;
        if (!active) {
          setPhase("starter");
          return;
        }
        setView(active as RichView);
        setPhase("world");
      })
      .catch((e) => {
        toast(errorText(e), "error");
        setPhase("error");
      });
  }, [toast]);

  // Weather, refreshed every ten minutes.
  useEffect(() => {
    let alive = true;
    const pull = () =>
      get<Weather | null>("/api/weather")
        .then((w) => alive && setWeather(w))
        .catch(() => undefined);
    pull();
    const id = setInterval(pull, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // The clock drives the light rig.
  useEffect(() => {
    const id = setInterval(() => handleRef.current?.setTimeOfDay(localHours()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load the active pokemon into the world. Keyed on identity, not the
  // whole view: the stream replaces the view every few seconds and must
  // not restart or cancel a load in progress.
  const activeId = view?.id ?? null;
  const species = view?.species ?? null;
  const aspectsKey = view?.aspects.join(",") ?? "";
  const dioramaId = toDiorama(view?.state.location.diorama);
  const startAsleep = useRef(false);
  const asleepNow = view?.state.asleep ?? false;
  useEffect(() => {
    startAsleep.current = asleepNow;
  }, [asleepNow]);
  useEffect(() => {
    if (phase !== "world" || !activeId || !species) return;
    const aspects = aspectsKey ? aspectsKey.split(",") : [];
    let alive = true;
    (async () => {
      const handle = await withHandle();
      if (!alive) return;
      setModelReady(false);
      try {
        const bundle = await loadSpeciesBundle(species, aspects);
        if (!alive) return;
        await handle.setPokemon(bundle, aspects);
        if (!alive) return;
        setModelReady(true);
        handle.play(startAsleep.current ? "sleep" : "idle");
      } catch (e) {
        if (alive) toast(`Could not load ${species}: ${errorText(e)}`, "error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [phase, activeId, species, aspectsKey, withHandle, toast]);

  useEffect(() => {
    if (phase !== "world") return;
    let alive = true;
    withHandle().then((handle) => alive && handle.setDiorama(dioramaId));
    return () => {
      alive = false;
    };
  }, [phase, dioramaId, withHandle]);

  // Sleep state follows the view.
  const asleep = view?.state.asleep ?? false;
  useEffect(() => {
    if (!modelReady) return;
    handleRef.current?.play(asleep ? "sleep" : "idle");
  }, [asleep, modelReady]);

  // Live state and brain events.
  const pokemonId = view?.id ?? null;
  useEffect(() => {
    if (!pokemonId) return;
    const source = new EventSource(`/api/pokemon/${pokemonId}/stream`);
    source.addEventListener("state", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { view: RichView };
        setView(data.view);
      } catch {
        // A malformed frame is dropped; the next tick replaces it.
      }
    });
    source.addEventListener("brain", (e) => {
      let msg: { activity?: string; emote?: string; dialogue?: string; cry?: boolean };
      try {
        msg = JSON.parse((e as MessageEvent).data);
      } catch {
        return;
      }
      const handle = handleRef.current;
      const activity = toActivity(msg.activity);
      if (handle && activity) handle.play(activity);
      const emote = toEmote(msg.emote);
      if (handle && emote) handle.emote(emote);
      if (handle && msg.cry) handle.cry();
      if (msg.dialogue) setDialogue(msg.dialogue);
    });
    return () => source.close();
  }, [pokemonId]);

  const journalNew = useMemo(() => (view ? hasUnread(view.id, view.memories) : false), [view]);

  const bag: BagEntry[] = me?.bag ?? [];

  const applyOutcome = useCallback(
    (before: RichView, outcome: CareOutcome, req: CareRequest) => {
      const next = outcome.view as RichView;
      const moved: Deltas = {};
      for (const need of Object.keys(next.needs) as NeedName[]) {
        const d = next.needs[need] - before.needs[need];
        if (Math.abs(d) >= 1) moved[need] = d;
      }
      setDeltas(moved);
      setTimeout(() => setDeltas({}), 1400);
      setView(next);
      if (req.item) setMe((m) => (m ? { ...m, bag: m.bag.map((b) => (b.itemId === req.item ? { ...b, qty: b.qty - 1 } : b)).filter((b) => b.qty > 0) } : m));
      if (outcome.balance !== undefined) setMe((m) => (m ? { ...m, bytes: outcome.balance } : m));
      const handle = handleRef.current;
      if (outcome.refused) {
        toast(`${next.name} isn't interested right now`, "info");
        handle?.emote("question");
        return;
      }
      if (outcome.mistake) {
        toast("That was a care mistake", "error");
        handle?.emote("sad");
      } else {
        const emote: EmoteKind = req.action === "feed" ? "happy" : req.action === "play" ? "music" : req.action === "pet" ? "love" : req.action === "rest" ? "sleepy" : req.action === "discipline" ? "angry" : "happy";
        handle?.emote(emote);
      }
      if (req.action === "play" && handle) handle.cry();
      for (const level of outcome.levelsGained) toast(`Level up! ${next.name} is Lv. ${level}`, "success");
      if (outcome.bytes > 0) toast(`+${outcome.bytes} Bytes`, "success");
    },
    [toast],
  );

  const care = useCallback(
    async (req: CareRequest, closeSheet = true) => {
      if (!view || busy) return;
      setBusy(true);
      try {
        const outcome = await post<CareOutcome>(`/api/pokemon/${view.id}/care`, req);
        applyOutcome(view, outcome, req);
        if (closeSheet) setSheet(null);
        get<Me>("/api/me")
          .then(setMe)
          .catch(() => undefined);
      } catch (e) {
        toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [view, busy, applyOutcome, toast],
  );

  const pet = useCallback(() => {
    if (!view || photo) return;
    const now = Date.now();
    if (now - lastPet.current < 1500) {
      handleRef.current?.emote("love");
      return;
    }
    lastPet.current = now;
    handleRef.current?.emote("love");
    post<CareOutcome>(`/api/pokemon/${view.id}/care`, { action: "pet" })
      .then((outcome) => applyOutcome(view, outcome, { action: "pet" }))
      .catch((e) => toast(errorText(e), "error"));
  }, [view, photo, applyOutcome, toast]);

  const onTalk = useCallback((reply: TalkReply) => {
    const handle = handleRef.current;
    const emote = toEmote(reply.emote);
    if (handle && emote) handle.emote(emote);
    if (handle && reply.cry) handle.cry();
    setDialogue(reply.line);
  }, []);

  const snap = useCallback(async () => {
    const canvas = worldBox.current?.querySelector("canvas");
    if (!canvas || !view) {
      toast("Nothing to photograph yet", "error");
      return;
    }
    // The drawing buffer is not preserved between frames; grab it right
    // after the renderer paints, inside the same animation frame.
    const blob = await new Promise<Blob | null>((resolve) => requestAnimationFrame(() => canvas.toBlob(resolve, "image/png")));
    if (!blob) {
      toast("The camera jammed", "error");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const how = await shareOrDownload(blob, `${view.name.toLowerCase()}-${stamp}.png`, `${view.name}`);
    toast(how === "shared" ? "Shared" : "Saved to downloads", "success");
  }, [view, toast]);

  const openJournal = useCallback(() => {
    router.push("/journal");
  }, [router]);

  const discard = useCallback(
    (itemId: string) => {
      toast(`No way to toss ${itemId.replace(/_/g, " ")} yet`, "info");
    },
    [toast],
  );

  const hudHidden = photo || phase !== "world";
  const actionBottom = "calc(var(--spacing-tab) + var(--spacing-safe-bottom) + 12px)";
  const dioramaLabel = useMemo(() => (view ? toDiorama(view.state.location.diorama) : "meadow"), [view]);

  return (
    <div ref={worldBox} className="fixed inset-0 md:left-56" style={{ bottom: 0 }}>
      {phase === "error" ? (
        <WorldPlaceholder text="The meadow is out of reach" />
      ) : (
        <World onReady={onReady}>
          {/* Tap zone over where the pokemon stands; petting needs no hit test on the model. */}
          {phase === "world" && !photo ? (
            <button
              type="button"
              aria-label={`Pet ${view?.name ?? "your pokemon"}`}
              onClick={pet}
              className="absolute left-1/2 top-[38%] h-[34%] w-[62%] -translate-x-1/2 cursor-pointer rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              style={{ touchAction: "manipulation" }}
            />
          ) : null}
          {asleep ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#060a1a]/45 transition-opacity" /> : null}
        </World>
      )}

      {phase === "loading" ? <WorldPlaceholder text="Finding your trainer card" /> : null}

      {phase === "starter" ? (
        <StarterPicker
          open
          onPicked={(picked) => {
            setView(picked as RichView);
            setPhase("world");
            get<Me>("/api/me")
              .then(setMe)
              .catch(() => undefined);
          }}
        />
      ) : null}

      {!hudHidden && view ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-3" style={{ paddingTop: "calc(var(--spacing-safe-top) + 12px)" }}>
            <div className="pointer-events-auto flex shrink-0 flex-col gap-2">
              <NameCard view={view} />
              <MetersCard view={view} deltas={deltas} />
            </div>
            <div className="pointer-events-auto flex min-w-0 flex-col items-end gap-2">
              <ClockCard weather={weather} />
              <SquareButton icon="camera" label="Photo mode" onClick={() => setPhoto(true)} />
              <SquareButton icon="book" label="Journal" badge={journalNew} onClick={openJournal} />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-3 px-3" style={{ bottom: actionBottom }}>
            <div className="pointer-events-auto w-full max-w-lg">
              <DialogueBox speaker={view.name} text={dialogue} onDone={() => setDialogue(null)} />
            </div>
            <div className="pointer-events-auto flex w-full max-w-lg items-stretch gap-2 md:justify-center">
              <ActionButton icon="apple" label="Feed" onClick={() => setSheet("feed")} />
              <ActionButton icon="pokeball" label="Play" onClick={() => setSheet("play")} />
              <ActionButton icon="brush" label="Groom" onClick={() => setSheet("groom")} />
              {asleep ? (
                <ActionButton icon="sun" label="Wake" onClick={() => setSheet("rest")} />
              ) : (
                <ActionButton icon="pillow" label="Rest" onClick={() => setSheet("rest")} />
              )}
              <ActionButton icon="bag" label="Items" onClick={() => setSheet("items")} />
            </div>
          </div>

          <Microphone pokemonId={view.id} onReply={onTalk} home={{ right: 12, bottom: 0 }} />

          {!modelReady ? (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="card flex items-center gap-2 px-3 py-2">
                <span className="bob">
                  <PixelIcon name="pokeball" size={20} />
                </span>
                <span className="font-pixel text-xs">{view.name} is on the way to the {dioramaLabel}</span>
              </div>
            </div>
          ) : null}

          {view.status === "home" && me ? (
            <span className="sr-only">
              {me.bytes} Bytes, mood {view.mood.label}
            </span>
          ) : null}
        </>
      ) : null}

      {photo ? (
        <div className="absolute inset-x-0 flex items-center justify-center gap-3 px-4" style={{ bottom: actionBottom }}>
          <Button variant="ghost" onClick={() => setPhoto(false)} className="h-12 px-5">
            Done
          </Button>
          <Button variant="primary" icon="camera" onClick={snap} className="h-12 px-6">
            Snap
          </Button>
        </div>
      ) : null}

      {view ? (
        <CareSheet kind={sheet} onClose={() => setSheet(null)} view={view} bag={bag} catalog={catalog} busy={busy} onCare={(req) => void care(req, req.action !== "wake" && sheet !== "items")} onDiscard={discard} />
      ) : null}
    </div>
  );
}
