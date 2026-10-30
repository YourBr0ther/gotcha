"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { fetchAmbientCandidates, pickAmbient, type AmbientPick } from "./ambient/candidates";
import { loadSpeciesBundle } from "./bundle";
import { CreatureRig, loadCreature } from "./creature/rig";
import { getDiorama, type DioramaId } from "./dioramas";
import type { DioramaDef } from "./dioramas/types";
import { useWorldState } from "./WorldContext";

interface Dressed {
  rig: CreatureRig;
  pick: AmbientPick;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A walker ambles between the two ambient spots, pausing at each. */
async function amble(rig: CreatureRig, alive: { current: boolean }): Promise<void> {
  const spots = ["ambient_1", "ambient_2"];
  let i = 0;
  while (alive.current) {
    await rig.moveTo(spots[i % spots.length]);
    if (!alive.current) return;
    await wait(2500 + Math.random() * 3000);
    i++;
  }
}

/** Circle high over the back of the air volume, so the flier reads as distant set dressing. */
function circle(rig: CreatureRig, def: DioramaDef): void {
  const air = def.air[0];
  if (!air) return;
  const radius = Math.max(1.2, Math.min(air.w, air.d) / 5);
  rig.setOrbit({
    x: air.x + air.w / 2,
    z: air.z + Math.min(air.d * 0.3, radius + 1),
    y: air.yMax,
    radius,
    speed: (rig.locomotion.flies ? 0.45 : 0.3) * (Math.random() < 0.5 ? 1 : -1),
  });
}

/**
 * Up to two wild pokemon as set dressing: a flier circling the air volume
 * and a walker (or swimmer) ambling between the ambient spots. Idle clips
 * only, no needs, no brain. Loaded through the same bundle loader as the
 * active pokemon.
 */
export function Ambient() {
  const { diorama, ambient, bundle } = useWorldState();
  const [dressed, setDressed] = useState<{ id: DioramaId; rigs: Dressed[] } | null>(null);
  const pendingDispose = useRef(new Map<CreatureRig, number>());
  const active = bundle?.species;

  useEffect(() => {
    let cancelled = false;
    const def = getDiorama(diorama);
    (async () => {
      if (!ambient) {
        await Promise.resolve();
        if (!cancelled) setDressed(null);
        return;
      }
      const candidates = await fetchAmbientCandidates(diorama);
      const picks = pickAmbient(candidates, diorama, active ? [active] : []);
      const loaded = await Promise.all(
        picks.map(async (pick) => {
          const b = await loadSpeciesBundle(pick.species);
          return { pick, creature: await loadCreature(b, []) };
        }),
      );
      if (cancelled) {
        for (const l of loaded) l.creature.dispose();
        return;
      }
      setDressed({ id: diorama, rigs: loaded.map((l) => ({ pick: l.pick, rig: new CreatureRig(l.creature, def) })) });
    })().catch((err: unknown) => {
      console.warn("[world] ambient pokemon failed to load", err);
    });
    return () => {
      cancelled = true;
    };
  }, [diorama, ambient, active]);

  // Dispose rigs a tick after they are replaced so StrictMode's rerun cancels it.
  useEffect(() => {
    const rigs = dressed?.rigs;
    if (!rigs) return;
    const pending = pendingDispose.current;
    for (const { rig } of rigs) {
      const timer = pending.get(rig);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        pending.delete(rig);
      }
    }
    return () => {
      for (const { rig } of rigs) {
        pending.set(
          rig,
          window.setTimeout(() => {
            pending.delete(rig);
            rig.dispose();
          }, 0),
        );
      }
    };
  }, [dressed]);

  if (!ambient || !dressed || dressed.id !== diorama) return null;
  return (
    <>
      {dressed.rigs.map(({ rig, pick }) => (
        <AmbientRig key={pick.species} rig={rig} pick={pick} def={getDiorama(dressed.id)} />
      ))}
    </>
  );
}

function AmbientRig({ rig, pick, def }: { rig: CreatureRig; pick: AmbientPick; def: DioramaDef }) {
  useEffect(() => {
    const alive = { current: true };
    if (pick.role === "flier" && rig.locomotion.flies) {
      rig.teleport(def.spots.air_1 ?? def.spots.ambient_1 ?? def.spawn);
      circle(rig, def);
    } else {
      rig.teleport(def.spots.ambient_1 ?? def.spawn);
      amble(rig, alive).catch(() => {});
    }
    return () => {
      alive.current = false;
      rig.cancelMove();
    };
  }, [rig, pick, def]);

  useFrame((_, delta) => {
    rig.update(Math.min(delta, 0.1), null);
  });

  return <primitive object={rig.group} />;
}
