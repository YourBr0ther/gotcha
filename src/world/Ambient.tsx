"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { type AmbientPick, CAST_SIZE, dayKey, fetchAmbientCandidates, pickCast } from "./ambient/candidates";
import { chooseVisitor, probeAmbient } from "./ambient/loadable";
import { between, type GroundPlan, nextWanderTarget, type OrbitPlan, type PassPlan, planVisit, TIMING, type VisitPlan } from "./ambient/wander";
import { loadSpeciesBundle } from "./bundle";
import { CreatureRig, loadCreature } from "./creature/rig";
import { getDiorama, type DioramaId } from "./dioramas";
import { useWorldState } from "./WorldContext";

interface Visitor {
  rig: CreatureRig;
  pick: AmbientPick;
  /** Opacity the frame loop eases toward. */
  fadeTo: number;
}

/** Seconds a visitor takes to fade in at its entry and out at its exit. */
const FADE_SECONDS = 0.6;

/** A world with no pokemon on the way still gets its visitors, after this long. */
const NO_CREATURE_GRACE_MS = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Development only: `?ambientTempo=0.1` on the dev page runs the schedule ten times faster. */
function tempo(): number {
  if (process.env.NODE_ENV === "production") return 1;
  const t = (window as unknown as { __ambientTempo?: number }).__ambientTempo;
  return typeof t === "number" && t > 0 ? t : 1;
}

type Alive = { current: boolean };

/** Walk or swim in from the rim, wander for the stay, then leave by the exit. */
async function groundVisit(v: Visitor, plan: GroundPlan, stayMs: number, alive: Alive, rand: () => number): Promise<void> {
  const { rig } = v;
  const until = performance.now() + stayMs;
  while (alive.current && performance.now() < until) {
    const target = nextWanderTarget(plan, rig.grid, rig.group.position, rand);
    if (!target) break;
    await rig.moveTo(target);
    if (!alive.current) return;
    await wait(between(TIMING.pause, rand) * 1000 * tempo());
  }
  if (!alive.current) return;
  await rig.moveTo(plan.exit);
}

/** Fly in, circle at one or two spots, fly out. */
async function orbitVisit(v: Visitor, plan: OrbitPlan, stayMs: number, alive: Alive): Promise<void> {
  const { rig } = v;
  await rig.moveTo(plan.approach);
  if (!alive.current) return;
  const share = stayMs / plan.orbits.length;
  for (const orbit of plan.orbits) {
    rig.setOrbit(orbit);
    await wait(share);
    if (!alive.current) return;
  }
  rig.setOrbit(null);
  await rig.moveTo(plan.exit);
}

/** Cross the scene and keep going. */
async function passVisit(v: Visitor, plan: PassPlan, alive: Alive): Promise<void> {
  for (const wp of plan.waypoints) {
    await v.rig.moveTo(wp);
    if (!alive.current) return;
  }
  await v.rig.moveTo(plan.exit);
}

async function runVisit(v: Visitor, plan: VisitPlan, stayMs: number, alive: Alive, rand: () => number): Promise<void> {
  v.rig.setOpacity(0);
  v.rig.teleport(plan.entry);
  v.fadeTo = 1;
  if (plan.kind === "ground") await groundVisit(v, plan, stayMs, alive, rand);
  else if (plan.kind === "orbit") await orbitVisit(v, plan, stayMs, alive);
  else await passVisit(v, plan, alive);
  if (!alive.current) return;
  v.fadeTo = 0;
  await wait(FADE_SECONDS * 1000 + 50);
}

/**
 * One wild pokemon at a time as set dressing, and often none. A scene keeps
 * a small daily cast of species that spawn in its biome; every minute or so
 * one of them arrives at the edge, wanders a route of its own for half a
 * minute, and leaves. Idle and travel clips only, no needs, no brain.
 * Loaded through the same bundle loader as the active pokemon, but only
 * once that pokemon has drawn its first frame, so a visitor never competes
 * with it for bandwidth or the main thread.
 */
export function Ambient() {
  const { diorama, ambient, bundle, loadToken, shownToken } = useWorldState();
  const [visitor, setVisitor] = useState<{ id: DioramaId; v: Visitor } | null>(null);
  const active = bundle?.species;
  const creatureShown = !bundle || shownToken === loadToken;

  useEffect(() => {
    if (!ambient || !creatureShown) return;
    const alive: Alive = { current: true };
    const def = getDiorama(diorama);
    const rand = Math.random;
    let current: Visitor | null = null;
    const show = (v: Visitor | null) => {
      current = v;
      if (alive.current) setVisitor(v ? { id: diorama, v } : null);
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __ambientVisitor?: Visitor | null }).__ambientVisitor = v;
      }
    };
    (async () => {
      if (!active) await wait(NO_CREATURE_GRACE_MS);
      if (!alive.current) return;
      const candidates = await fetchAmbientCandidates(diorama);
      const cast = pickCast(candidates, `${diorama}:${dayKey()}`, active ? [active] : [], def.water.some((w) => w.swimmable !== false), CAST_SIZE);
      if (cast.length === 0) return;
      // The last two visitors sit out the next draw, so a cast of six rotates.
      const recent: string[] = [];
      let delay = between(TIMING.firstVisit, rand);
      while (alive.current) {
        await wait(delay * 1000 * tempo());
        if (!alive.current) return;
        const exclude = [active, ...recent].filter((s): s is string => Boolean(s));
        const pick = await chooseVisitor(cast, exclude, probeAmbient, rand);
        if (!pick || !alive.current) return;
        const b = await loadSpeciesBundle(pick.species, [], { label: "ambient:bundle", particles: false });
        const creature = await loadCreature(b, [], "ambient");
        if (!alive.current) {
          creature.dispose();
          return;
        }
        const rig = new CreatureRig(creature, def);
        const plan = planVisit(def, rig.grid, pick.role, rand);
        recent.push(pick.species);
        if (recent.length > 2) recent.shift();
        delay = between(TIMING.gap, rand);
        if (!plan) {
          rig.dispose();
          continue;
        }
        const v: Visitor = { rig, pick, fadeTo: 0 };
        show(v);
        await runVisit(v, plan, between(TIMING.stay, rand) * 1000 * tempo(), alive, rand);
        if (!alive.current) return;
        show(null);
        rig.dispose();
      }
    })().catch((err: unknown) => {
      console.warn("[world] ambient visitor failed", err);
    });
    return () => {
      alive.current = false;
      const v = current;
      current = null;
      setVisitor(null);
      // Let React drop the primitive before the geometry goes.
      if (v) window.setTimeout(() => v.rig.dispose(), 0);
    };
  }, [diorama, ambient, active, creatureShown]);

  if (!ambient || !visitor || visitor.id !== diorama) return null;
  return <VisitorRig key={visitor.v.pick.species} v={visitor.v} />;
}

function VisitorRig({ v }: { v: Visitor }) {
  const opacity = useRef(0);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const step = dt / FADE_SECONDS;
    const o = opacity.current;
    const next = v.fadeTo > o ? Math.min(v.fadeTo, o + step) : Math.max(v.fadeTo, o - step);
    if (next !== o) {
      opacity.current = next;
      v.rig.setOpacity(next);
    }
    v.rig.update(dt, null);
  });
  return <primitive object={v.rig.group} />;
}
