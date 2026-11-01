"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DioramaId, EmoteKind, WorldHandle } from "../api";
import { isDioramaId, localHours } from "../api";
import { getDiorama } from "../dioramas";
import { createCubeBundle } from "../fixtures";
import World from "../World";
import { loadSpeciesBundle } from "../bundle";

/** The demo loop visits these in order, skipping any the diorama lacks. */
const ROUTE = ["forage_1", "play_1", "swim_1", "forage_2", "air_1", "sleep_1", "play_1"] as const;
const EMOTES: EmoteKind[] = ["happy", "love", "question", "music", "surprise"];

function wait(ms: number, alive: { current: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (!alive.current) clearTimeout(t);
  });
}

interface Params {
  debug: boolean;
  hour: number | null;
  /** A species from .cobblemon-cache, or null for the synthetic cube. */
  species: string | null;
  aspects: string[];
  /** demo=0 holds the creature at the spawn spot and cycles emotes and cries; demo=hold holds it still so a script can drive it. */
  demo: "route" | "spot" | "hold";
  diorama: DioramaId;
  ambient: boolean;
  /** Multiplier on the ambient visit schedule; 0.1 brings the first visitor in under a second. */
  ambientTempo: number;
  depth: boolean;
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const hour = q.get("hour");
  const aspects = (q.get("aspects") ?? "").split(",").filter(Boolean);
  return {
    debug: q.get("debug") === "1",
    hour: hour !== null ? parseFloat(hour) : null,
    species: q.get("species"),
    aspects,
    demo: q.get("demo") === "0" ? "spot" : q.get("demo") === "hold" ? "hold" : "route",
    diorama: isDioramaId(q.get("diorama") ?? "") ? (q.get("diorama") as DioramaId) : "meadow",
    ambient: q.get("ambient") !== "0",
    ambientTempo: parseFloat(q.get("ambientTempo") ?? "1") || 1,
    depth: q.get("depth") !== "0",
  };
}

export default function DevWorld() {
  const [params] = useState<Params>(readParams);
  const [status, setStatus] = useState("loading");
  const handleRef = useRef<WorldHandle | null>(null);

  // Applied here as well as in the run effect, so a remount of <World>
  // (hot reload gives it a fresh store) keeps the scene the URL asked for.
  const onReady = useCallback(
    (handle: WorldHandle) => {
      handleRef.current = handle;
      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __worldHandle?: WorldHandle; __ambientTempo?: number };
        w.__worldHandle = handle;
        w.__ambientTempo = params.ambientTempo;
      }
      handle.setTimeOfDay(params.hour ?? localHours());
      handle.setAmbient(params.ambient);
      handle.setDiorama(params.diorama);
    },
    [params],
  );

  useEffect(() => {
    const alive = { current: true };
    const run = async () => {
      // onReady fires in an effect of the child, so it has run by now.
      const handle = handleRef.current;
      if (!handle) return;
      handle.setTimeOfDay(params.hour ?? localHours());
      handle.setAmbient(params.ambient);
      if (params.diorama !== "meadow") handle.setDiorama(params.diorama);
      setStatus(params.species ? `loading ${params.species}` : "loading cube");
      const bundle = params.species ? await loadSpeciesBundle(params.species, params.aspects) : createCubeBundle();
      await handle.setPokemon(bundle, params.aspects);
      setStatus("idle");
      await wait(1500, alive);
      let i = 0;
      let emotes = 0;
      if (params.demo === "hold") return;
      if (params.demo === "spot") {
        while (alive.current) {
          handle.emote(EMOTES[emotes++ % EMOTES.length]);
          await wait(3000, alive);
          handle.cry();
          await wait(3000, alive);
        }
        return;
      }
      const route = ROUTE.filter((spot) => spot in getDiorama(params.diorama).spots);
      while (alive.current) {
        const spot = route[i % route.length];
        setStatus(`walking to ${spot}`);
        const arrived = await handle.moveTo(spot);
        if (!alive.current) break;
        if (!arrived) {
          setStatus(`could not reach ${spot}`);
          await wait(1000, alive);
          i++;
          continue;
        }
        if (spot.startsWith("sleep")) {
          handle.play("sleep");
          setStatus("sleeping");
          handle.emote("sleepy");
          await wait(5000, alive);
          handle.play("idle");
        } else {
          setStatus(`idle at ${spot}`);
          handle.emote(EMOTES[emotes++ % EMOTES.length]);
          await wait(1200, alive);
          if (i % 2 === 1) {
            handle.cry();
            await wait(900, alive);
          }
          await wait(1200, alive);
        }
        i++;
      }
    };
    run().catch((err) => {
      console.error(err);
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      alive.current = false;
    };
  }, [params]);

  useEffect(() => {
    if (params.hour !== null) return;
    const id = setInterval(() => handleRef.current?.setTimeOfDay(localHours()), 30_000);
    return () => clearInterval(id);
  }, [params.hour]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b1026" }}>
      <World onReady={onReady} debug={params.debug} debugExtra={status} depth={params.depth} />
    </div>
  );
}
