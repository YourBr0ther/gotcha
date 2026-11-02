"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Activity, EmoteKind, WorldHandle, DioramaId } from "@/world/api";
import { isDioramaId, localHours } from "@/world/api";
import { loadSpeciesBundle } from "@/world/bundle";
import type { NeedName } from "@gotcha/cpkmn";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/primitives";
import { errorText, get, post, shareOrDownload, type BagEntry, type CareOutcome, type EvolveOutcome, type Me, type PartyView, type RichView, type StoreItem, type StoreResponse, type Weather } from "@/components/lib/api";
import type { JournalView } from "@/lib/services/journal";
import type { DiscardResult } from "@/lib/services/bag";
import { hasUnread } from "./journalMark";
import { readLowPower } from "@/components/lib/prefs";
import { ActionButton, ClockCard, MetersCard, NameCard, SquareButton, type Deltas } from "./Hud";
import { CareSheet, type CareKind, type CareRequest } from "./CareSheet";
import { DialogueBox } from "./DialogueBox";
import { EvolutionPrompt } from "./EvolutionPrompt";
import { MoreButton } from "./MenuButton";
import { Microphone, type TalkReply } from "./Microphone";
import { StarterPicker } from "./StarterPicker";
import { Tour, Welcome } from "./Onboarding";
import { EvolutionScene, type Evolving } from "./EvolutionScene";

const SKY = "bg-[linear-gradient(180deg,#5fa8e0_0%,#87c9a2_45%,#3f7a3a_75%,#28491f_100%)]";

const World = dynamic(() => import("@/world/World"), {
  ssr: false,
  // The cover above hides this; it only has to not be black.
  loading: () => <div className={`absolute inset-0 ${SKY}`} />,
});

function WorldPlaceholder({ text }: { text: string }) {
  return (
    <div className={`absolute inset-0 grid place-items-center ${SKY}`}>
      <div className="card flex items-center gap-3 px-4 py-3">
        <span className="bob">
          <PixelIcon name="pokeball" size={28} />
        </span>
        <span className="font-pixel text-sm">{text}</span>
      </div>
    </div>
  );
}

/**
 * One painted cover from the first paint until the world's first frame:
 * the pokemon's face bobbing over the sky, its name once the party is
 * known. Fades over the live scene. Before this there were two cards in a
 * row ("Finding your trainer card", then "Loading Maddie's meadow") over a
 * black canvas, and a one-second load felt like two steps.
 */
function LoadCover({ show, species, label }: { show: boolean; species: string | null; label: string | null }) {
  const [broken, setBroken] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (show) return;
    const timer = setTimeout(() => setGone(true), 500);
    return () => clearTimeout(timer);
  }, [show]);
  if (gone) return null;
  return (
    <div
      aria-hidden={!show}
      role={show ? "status" : undefined}
      className={`absolute inset-0 z-30 grid place-items-center ${SKY} transition-opacity duration-500 ease-out`}
      style={{ opacity: show ? 1 : 0, pointerEvents: show ? "auto" : "none" }}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="bob">
          {species && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element -- portraits come from the data volume, not next/image.
            <img src={`/api/assets/portraits/${species}`} alt="" width={96} height={96} decoding="async" onError={() => setBroken(true)} className="h-24 w-24 rounded-2xl bg-white/15 object-cover shadow-[0_6px_0_rgb(0_0_0/0.25)]" />
          ) : (
            <PixelIcon name="pokeball" size={56} />
          )}
        </span>
        <span className="font-pixel text-sm text-white drop-shadow-[0_2px_0_rgb(0_0_0/0.5)]">{label ?? "\u00a0"}</span>
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

/**
 * The footer tag on the dialogue box. The model's short name ("GLM" for
 * zai-org/glm-5.2) when the model answered, "rules" for the fallback. The
 * talk route does not name its model yet, so GLM is the default.
 */
function brainTag(source: string | undefined, model?: string): string {
  if (source !== "model") return "rules";
  const name = (model ?? "glm").split("/").pop() ?? "glm";
  return name.split(/[-_.]/)[0].toUpperCase();
}

interface Dialogue {
  text: string;
  tag: string;
}

const subscribeNothing = () => () => undefined;
const readDebugFlag = () => new URLSearchParams(window.location.search).get("debug") === "1";

type Phase = "loading" | "starter" | "world" | "error";

export function HomeScreen() {
  const { toast } = useToast();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<RichView | null>(null);
  const [catalog, setCatalog] = useState<StoreItem[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [sheet, setSheetState] = useState<CareKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [deltas, setDeltas] = useState<Deltas>({});
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [photo, setPhoto] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  // Latched once: later pokemon swaps render into a live scene and never bring the cover back.
  const [worldShown, setWorldShown] = useState(false);
  const onFirstFrame = useCallback(() => setWorldShown(true), []);
  const [starterOpen, setStarterOpen] = useState(false);
  // Right after the first pick: the three-card tour over the new pokemon.
  const [tour, setTour] = useState(false);
  const [evolving, setEvolving] = useState<Evolving | null>(null);
  // `?debug=1` shows the world's stats overlay. Read from the location, not useSearchParams, so the page needs no Suspense boundary.
  const debug = useSyncExternalStore(subscribeNothing, readDebugFlag, () => false);
  const handleRef = useRef<WorldHandle | null>(null);
  const handleWaiters = useRef<Array<(h: WorldHandle) => void>>([]);
  const worldBox = useRef<HTMLDivElement>(null);
  const lastPet = useRef(0);
  // Opening a care sheet is attention too: the pokemon comes up front for it.
  const setSheet = useCallback((kind: CareKind | null) => {
    if (kind) handleRef.current?.attend();
    setSheetState(kind);
  }, []);

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
        // Opening the app is a visit: it comes up front to say hello before it wanders.
        handle.attend();
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

  // The evolution reveal waits for the new form to be in the scene, then flares.
  const revealWhenReady = useRef(false);
  useEffect(() => {
    if (!modelReady || !revealWhenReady.current) return;
    revealWhenReady.current = false;
    setEvolving((ev) => (ev && ev.stage === "glow" ? { ...ev, stage: "reveal" } : ev));
    const handle = handleRef.current;
    handle?.cry();
    setTimeout(() => handle?.emote("happy"), 600);
  }, [modelReady]);

  // Sleep state follows the view. A "Zz" emote marks the moment it dozes off,
  // once per nap, including a pokemon that arrives already asleep.
  const asleep = view?.state.asleep ?? false;
  const wasAsleep = useRef(false);
  useEffect(() => {
    if (!modelReady) {
      wasAsleep.current = false;
      return;
    }
    const handle = handleRef.current;
    handle?.play(asleep ? "sleep" : "idle");
    if (asleep && !wasAsleep.current) handle?.emote("sleepy");
    wasAsleep.current = asleep;
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
      let msg: { activity?: string; emote?: string; dialogue?: string; cry?: boolean; source?: string; model?: string };
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
      if (msg.dialogue) setDialogue({ text: msg.dialogue, tag: brainTag(msg.source, msg.model) });
    });
    return () => source.close();
  }, [pokemonId]);

  // The journal rides its own route, not the stream; fetch it when the pokemon
  // changes and again when the tab comes back, which covers returning from /journal.
  const [journalNewestAt, setJournalNewestAt] = useState<string | null>(null);
  useEffect(() => {
    if (!pokemonId) return;
    let alive = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      get<JournalView>(`/api/pokemon/${pokemonId}/journal`)
        .then((j) => {
          if (alive) setJournalNewestAt(j.newestAt);
        })
        .catch(() => undefined);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pokemonId]);
  const journalNew = useMemo(() => (pokemonId ? hasUnread(pokemonId, journalNewestAt) : false), [pokemonId, journalNewestAt]);

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
      } else if (req.action !== "rest") {
        // Rest gets its "Zz" from the sleep effect when the view flips to asleep.
        const emote: EmoteKind = req.action === "feed" ? "happy" : req.action === "play" ? "music" : req.action === "pet" ? "love" : req.action === "discipline" ? "angry" : "happy";
        handle?.emote(emote);
      }
      if (req.action === "play" && handle) handle.cry();
      for (const level of outcome.levelsGained) toast(`Level up! ${next.name} is Lv. ${level}`, "success");
      if (outcome.bytes > 0) toast(`+${outcome.bytes} Bytes`, "success");
    },
    [toast],
  );

  // The evolution ask: yes swaps the species, which the load effect above
  // picks up and walks the new form in; no is for now or for good.
  const evolve = useCallback(
    async (to: string) => {
      if (!view) return;
      setBusy(true);
      setEvolving({ name: view.name, from: view.species, to, stage: "glow", bytes: 0 });
      handleRef.current?.attend(60_000);
      setDialogue(null);
      // The light breathes for a few seconds whatever the server takes; the swap happens under it.
      const glow = new Promise<void>((resolve) => setTimeout(resolve, 3600));
      try {
        const outcome = await post<EvolveOutcome>(`/api/pokemon/${view.id}/evolve`, { to });
        await glow;
        const next = outcome.view as RichView;
        setView(next);
        setMe((m) => (m ? { ...m, bytes: outcome.balance } : m));
        setEvolving({ name: next.name, from: view.species, to: next.species, stage: "glow", bytes: outcome.bytes });
        revealWhenReady.current = true;
      } catch (e) {
        await glow;
        setEvolving((ev) => (ev ? { ...ev, stage: "failed" } : ev));
        toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [view, toast],
  );
  const declineEvolve = useCallback(
    async (forever: boolean) => {
      if (!view) return;
      setBusy(true);
      try {
        const r = await post<{ view: RichView }>(`/api/pokemon/${view.id}/evolve`, { decline: forever ? "forever" : "now" });
        setView(r.view);
        handleRef.current?.emote(forever ? "sad" : "question");
      } catch (e) {
        toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [view, toast],
  );

  const care = useCallback(
    async (req: CareRequest, closeSheet = true) => {
      handleRef.current?.attend();
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
    [view, busy, applyOutcome, toast, setSheet],
  );

  const pet = useCallback(() => {
      handleRef.current?.attend();
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
      handleRef.current?.attend();
    const handle = handleRef.current;
    const emote = toEmote(reply.emote);
    if (handle && emote) handle.emote(emote);
    if (handle && reply.cry) handle.cry();
    setDialogue({ text: reply.line, tag: brainTag(reply.source, reply.model) });
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
    async (itemId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await post<DiscardResult>("/api/bag", { op: "discard", itemId, qty: 1 });
        setMe((m) => (m ? { ...m, bag: result.bag } : m));
        const name = catalog.find((i) => i.id === itemId)?.name ?? itemId.replace(/_/g, " ");
        toast(result.remaining > 0 ? `Tossed one ${name}, ${result.remaining} left` : `Tossed the last ${name}`, "info");
      } catch (e) {
        toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [busy, catalog, toast],
  );

  const hudHidden = photo || phase !== "world" || evolving !== null;
  // Home has no tab bar, so the action row sits right above the home
  // indicator. With the debug overlay on, the row lifts by a tab height
  // and the overlay takes that strip.
  const safeBottom = "calc(var(--spacing-safe-bottom) + 12px)";
  const actionBottom = safeBottom;
  const dioramaLabel = useMemo(() => (view ? toDiorama(view.state.location.diorama) : "meadow"), [view]);

  return (
    <div ref={worldBox} className="home-world fixed inset-0 md:left-56" style={{ bottom: 0 }}>
      {phase === "error" ? (
        <WorldPlaceholder text="The meadow is out of reach" />
      ) : (
        <World onReady={onReady} debug={debug} expectCreature={phase === "world"} onFirstFrame={onFirstFrame}>
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

      {phase !== "error" ? <LoadCover show={phase === "loading" || !worldShown} species={view?.species ?? null} label={view ? `${view.name}'s ${dioramaLabel}` : null} /> : null}

      {phase === "starter" ? (
        <>
          <StarterPicker
            open={starterOpen}
            onClose={() => setStarterOpen(false)}
            onPicked={(picked) => {
              setStarterOpen(false);
              setView(picked as RichView);
              setPhase("world");
              setTour(true);
              get<Me>("/api/me")
                .then(setMe)
                .catch(() => undefined);
            }}
          />
          {!starterOpen ? (
            <>
              <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
                <div className="w-full max-w-sm">
                  <Welcome name={me?.name ?? null} inPc={me?.counts.pc ?? 0} onStart={() => setStarterOpen(true)} />
                </div>
              </div>
              <div className="absolute right-3" style={{ bottom: safeBottom }}>
                <MoreButton variant="round" className="md:hidden" />
              </div>
            </>
          ) : null}
        </>
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
            {!view.state.asleep && !dialogue ? (
              <div className="pointer-events-auto w-full max-w-lg">
                <EvolutionPrompt view={view} bag={bag} catalog={catalog} busy={busy} onEvolve={(to) => void evolve(to)} onDecline={(forever) => void declineEvolve(forever)} />
              </div>
            ) : null}
            <div className="pointer-events-auto w-full max-w-lg">
              {tour && modelReady ? <Tour name={view.name} onDone={() => setTour(false)} /> : <DialogueBox speaker={view.name} text={dialogue?.text ?? null} tag={debug ? dialogue?.tag : null} onDone={() => setDialogue(null)} />}
            </div>
            {/* The microphone sits in its own row above the actions so it never overlaps them at any phone height. */}
            <div className="flex w-full max-w-lg items-end justify-end gap-2">
              <Microphone pokemonId={view.id} onReply={onTalk} className="pointer-events-auto" />
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
              <ActionButton icon="bag" label="Bag" onClick={() => setSheet("items")} />
              <MoreButton className="pointer-events-auto md:hidden" />
            </div>
          </div>

          {!modelReady && worldShown ? (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="card flex items-center gap-2 px-3 py-2">
                <span className="bob">
                  <PixelIcon name="pokeball" size={20} />
                </span>
                <span className="font-pixel text-xs">Loading {view.name}&apos;s {dioramaLabel}</span>
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

      {evolving ? <EvolutionScene evolving={evolving} onDone={() => setEvolving(null)} /> : null}

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
        <CareSheet kind={sheet} onClose={() => setSheet(null)} view={view} bag={bag} catalog={catalog} busy={busy} onCare={(req) => void care(req, req.action !== "wake" && sheet !== "items")} onDiscard={(itemId) => void discard(itemId)} />
      ) : null}
    </div>
  );
}
