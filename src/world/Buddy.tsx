"use client";

import { useEffect } from "react";
import { between } from "./ambient/wander";
import { buddyStage, cellsWhere, reachable } from "./ambient/wander";
import { getDiorama } from "./dioramas";
import type { Spot } from "./dioramas/types";
import { useWorldState, useWorldStore } from "./WorldContext";

/**
 * What the trainer's own pokemon does with its time. While the trainer is
 * here (anything tapped in the last while) it stands up front at its home
 * spot and looks at them. When the taps stop it roams the visible ground
 * instead of staring: a few blocks to one side, a forage spot, back again,
 * with a pause at each, and it comes straight back up front on the next
 * tap. Asleep or fainted it stays put. A "walk" from the brain sends it
 * somewhere right away rather than walking on the spot.
 */
/** Seconds between arriving somewhere and setting off again. */
const PAUSE = [6, 14] as const;
/** Seconds before the first roam after the trainer goes quiet. */
const FIRST_ROAM = [3, 8] as const;
/** How often the loop checks the clock. */
const TICK_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A facing that keeps the face toward the camera, give or take. */
function facingCamera(rand: () => number): number {
  return Math.PI + (rand() * 2 - 1) * 0.7;
}

export function Buddy() {
  const store = useWorldStore();
  const { diorama, attachedToken, loadToken, roamToken } = useWorldState();
  const attached = loadToken > 0 && attachedToken === loadToken;

  useEffect(() => {
    if (!attached) return;
    const creature = store.controller;
    if (!creature) return;
    let alive = true;
    const rand = Math.random;
    const def = getDiorama(diorama);
    const subject = def.framing.subject;
    const keep = buddyStage(subject);
    const home = creature.homeSpot;
    const haunts = Object.entries(def.spots)
      .filter(([name, s]) => /^forage_/.test(name) && keep(s.x, s.z))
      .map(([, s]) => s);
    const attending = () => store.state.attentionUntil > performance.now();
    const resting = () => {
      const a = creature.currentActivity;
      return a === "sleep" || a === "faint";
    };
    const atHome = () => Math.hypot(creature.position.x - home.x, creature.position.z - home.z) < 0.6;
    const roamTarget = (): Spot | null => {
      if (haunts.length && rand() < 0.3) return haunts[Math.floor(rand() * haunts.length)];
      const cells = cellsWhere(creature.grid, (x, z) => keep(x, z) && Math.hypot(x - creature.position.x, z - creature.position.z) >= 1.5);
      const p = reachable(creature.grid, creature.position, cells, rand);
      return p ? { x: p.x, z: p.z, facing: facingCamera(rand) } : null;
    };

    (async () => {
      let quietSince = performance.now();
      let wasAttending = true;
      let lastRoam = store.state.roamToken;
      let nextRoamAt = performance.now() + between(FIRST_ROAM, rand) * 1000;
      while (alive) {
        await wait(TICK_MS);
        if (!alive) return;
        if (resting()) continue;
        const now = performance.now();
        const here = attending();
        if (here) {
          // The trainer is back: come up front, once, and hold there.
          if (!wasAttending || (!atHome() && !creature.isMoving)) {
            wasAttending = true;
            if (!atHome()) await creature.moveTo({ ...home, facing: home.facing ?? Math.PI });
          }
          continue;
        }
        if (wasAttending) {
          wasAttending = false;
          quietSince = now;
          nextRoamAt = quietSince + between(FIRST_ROAM, rand) * 1000;
        }
        const asked = store.state.roamToken !== lastRoam;
        if (asked) lastRoam = store.state.roamToken;
        if (creature.isMoving || (now < nextRoamAt && !asked)) continue;
        const target = roamTarget();
        if (!target) {
          nextRoamAt = now + between(PAUSE, rand) * 1000;
          continue;
        }
        await creature.moveTo(target);
        if (!alive) return;
        if (creature.currentActivity !== "sleep") creature.play("idle");
        nextRoamAt = performance.now() + between(PAUSE, rand) * 1000;
      }
    })().catch((err: unknown) => console.warn("[world] buddy roaming stopped", err));
    return () => {
      alive = false;
    };
    // roamToken is read from the store inside the loop; listing it here would restart the loop on every brain tick.
  }, [store, diorama, attached]);

  // A fresh roam request while the loop sleeps between ticks is picked up within TICK_MS.
  void roamToken;
  return null;
}
