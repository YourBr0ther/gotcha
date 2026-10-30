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
import { Button, EmptyState } from "@/components/ui/primitives";
import { errorText, get, post, shareOrDownload, type BagEntry, type CareOutcome, type Me, type PartyView, type RichView, type StoreItem, type StoreResponse, type Weather } from "@/components/lib/api";
import type { JournalView } from "@/lib/services/journal";
import type { DiscardResult } from "@/lib/services/bag";
import { hasUnread } from "./journalMark";
import { readLowPower } from "@/components/lib/prefs";
import { ActionButton, ClockCard, MetersCard, NameCard, SquareButton, type Deltas } from "./Hud";
import { CareSheet, type CareKind, type CareRequest } from "./CareSheet";
import { DialogueBox } from "./DialogueBox";
import { MenuButton } from "./MenuButton";
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
  const [sheet, setSheet] = useState<CareKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [deltas, setDeltas] = useState<Deltas>({});
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [photo, setPhoto] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [starterOpen, setStarterOpen] = useState(true);
  // `?debug=1` shows the world's stats overlay. Read from the location, not useSearchParams, so the page needs no Suspense boundary.
  const debug = useSyncExternalStore(subscribeNothing, readDebugFlag, () => false);
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

  const hudHidden = photo || phase !== "world";
  // Home has no tab bar, so the action row sits right above the home
  // indicator. With the debug overlay on, the row lifts by a tab height
  // and the overlay takes that strip.
  const safeBottom = "calc(var(--spacing-safe-bottom) + 12px)";
  const actionBottom = debug ? "calc(var(--spacing-tab) + var(--spacing-safe-bottom) + 12px)" : safeBottom;
  const dioramaLabel = useMemo(() => (view ? toDiorama(view.state.location.diorama) : "meadow"), [view]);

  return (
    <div ref={worldBox} className="home-world fixed inset-0 md:left-56" style={{ bottom: 0 }}>
      {phase === "error" ? (
        <WorldPlaceholder text="The meadow is out of reach" />
      ) : (
        <World onReady={onReady} debug={debug}>
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
        <>
          <StarterPicker
            open={starterOpen}
            onClose={() => setStarterOpen(false)}
            onPicked={(picked) => {
              setView(picked as RichView);
              setPhase("world");
              get<Me>("/api/me")
                .then(setMe)
                .catch(() => undefined);
            }}
          />
          {!starterOpen ? (
            <>
              <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
                <div className="w-full max-w-sm">
                  <EmptyState
                    title="No pokemon yet"
                    text="The meadow is waiting for a friend. Pick one whenever you are ready."
                    action={
                      <Button variant="primary" onClick={() => setStarterOpen(true)} className="h-12 px-5">
                        Choose a starter
                      </Button>
                    }
                  />
                </div>
              </div>
              <div className="absolute right-3" style={{ bottom: safeBottom }}>
                <MenuButton className="md:hidden" />
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
            <div className="pointer-events-auto w-full max-w-lg">
              <DialogueBox speaker={view.name} text={dialogue?.text ?? null} tag={dialogue?.tag} onDone={() => setDialogue(null)} />
            </div>
            {/* Menu and microphone share a row above the actions so nothing overlaps at any phone height. */}
            <div className="flex w-full max-w-lg items-end justify-end gap-2">
              <MenuButton className="pointer-events-auto md:hidden" />
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
              <ActionButton icon="bag" label="Items" onClick={() => setSheet("items")} />
            </div>
          </div>

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
        <CareSheet kind={sheet} onClose={() => setSheet(null)} view={view} bag={bag} catalog={catalog} busy={busy} onCare={(req) => void care(req, req.action !== "wake" && sheet !== "items")} onDiscard={(itemId) => void discard(itemId)} />
      ) : null}
    </div>
  );
}
