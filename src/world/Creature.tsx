"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { getDiorama, type DioramaId } from "./dioramas";
import { CreatureRig, loadCreature } from "./creature/rig";
import { useWorldState, useWorldStore } from "./WorldContext";
import { mark } from "./perf";

interface Ready {
  rig: CreatureRig;
  token: number;
}

/**
 * Loads the bundle from the store and mounts one rig for it. The rig is
 * built inside the load effect, not a state initializer, because the
 * constructor re-parents the model and StrictMode runs initializers twice.
 */
export function Creature() {
  const store = useWorldStore();
  const { bundle, aspects, loadToken, diorama } = useWorldState();
  const [ready, setReady] = useState<Ready | null>(null);
  const pendingDispose = useRef(new Map<CreatureRig, number>());

  useEffect(() => {
    if (!bundle) return;
    let cancelled = false;
    mark("creature:effect");
    loadCreature(bundle, aspects)
      .then((loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        setReady({ rig: new CreatureRig(loaded, getDiorama(store.state.diorama)), token: loadToken });
      })
      .catch((err: unknown) => {
        console.error("[world] failed to load pokemon", err);
        store.failLoad(loadToken, err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [bundle, aspects, loadToken, store]);

  // Dispose a rig once it is replaced or the component unmounts. The dispose
  // is deferred a tick so StrictMode's cleanup-then-rerun cancels it.
  useEffect(() => {
    const rig = ready?.rig;
    if (!rig) return;
    const pending = pendingDispose.current;
    const timer = pending.get(rig);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pending.delete(rig);
    }
    return () => {
      pending.set(
        rig,
        window.setTimeout(() => {
          pending.delete(rig);
          rig.dispose();
        }, 0),
      );
    };
  }, [ready]);

  if (!bundle || !ready || ready.token !== loadToken) return null;
  return <Rig key={ready.token} rig={ready.rig} token={ready.token} dioramaId={diorama} />;
}

function Rig({ rig, token, dioramaId }: { rig: CreatureRig; token: number; dioramaId: DioramaId }) {
  const store = useWorldStore();

  const framed = useRef(false);
  useEffect(() => {
    mark("creature:attach");
    store.attachCreature(rig, token, rig.height, rig.restSpot);
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __creatureRig?: CreatureRig }).__creatureRig = rig;
    }
    return () => {
      store.detachCreature(rig);
    };
  }, [store, rig, token]);

  useEffect(() => {
    rig.setDiorama(getDiorama(dioramaId));
    store.attachCreature(rig, token, rig.height, rig.restSpot);
  }, [rig, dioramaId, store, token]);

  useFrame((state, delta) => {
    if (!framed.current) {
      framed.current = true;
      mark("creature-first-frame");
      // The next animation frame starts once this one's render (and any
      // shader compile it triggers) has finished: the creature is on screen.
      requestAnimationFrame(() => mark("creature-visible"));
      store.markShown(token);
    }
    rig.update(Math.min(delta, 0.1), state.camera.position);
  });

  return (
    <>
      <primitive object={rig.group} />
      <primitive object={rig.effects} />
    </>
  );
}
