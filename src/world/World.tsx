"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import type { WorldHandle } from "./api";
import { Creature } from "./Creature";
import { DayNight } from "./DayNight";
import { Diorama } from "./Diorama";
import { FixedCamera } from "./FixedCamera";
import { DebugOverlay, StatsProbe, type StatsSample } from "./Stats";
import { Ambient } from "./Ambient";
import { createWorldStore, FADE_MS } from "./store";
import { useWorldState, WorldStoreContext } from "./WorldContext";

export interface WorldProps {
  /** Receives the imperative handle once the store exists. */
  onReady?: (handle: WorldHandle) => void;
  /** Show the fps and draw-call overlay. */
  debug?: boolean;
  /** Extra text for the overlay's third line. */
  debugExtra?: string;
  /** Painted backdrop and weather particles. Default on; off for a slow device. */
  depth?: boolean;
  /** Anything to float over the world, like the HUD. */
  children?: ReactNode;
  className?: string;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * The whole diorama as one client component. Must be loaded with
 * `next/dynamic` and `ssr: false`; it touches the DOM on mount.
 */
export default function World({ onReady, debug = false, debugExtra, depth = true, children, className }: WorldProps) {
  const store = useMemo(() => createWorldStore(), []);
  const visible = useDocumentVisible();
  const [sample, setSample] = useState<StatsSample | null>(null);
  const onSample = useCallback((s: StatsSample) => setSample(s), []);

  useEffect(() => {
    onReady?.(store.handle);
  }, [onReady, store]);
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => store.setDepth(depth), [store, depth]);

  return (
    <div className={className} style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none" }}>
      <Canvas
        dpr={[1, 2]}
        frameloop={visible ? "always" : "never"}
        shadows="soft"
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        camera={{ fov: 50, near: 0.1, far: 80, position: [0.9, 1.35, 4.4] }}
        style={{ position: "absolute", inset: 0 }}
      >
        <WorldStoreContext.Provider value={store}>
          <FixedCamera />
          <DayNight />
          <Diorama />
          <Creature />
          <Ambient />
          {debug && <StatsProbe onSample={onSample} />}
        </WorldStoreContext.Provider>
      </Canvas>
      <WorldStoreContext.Provider value={store}>
        <FadeOverlay />
      </WorldStoreContext.Provider>
      {children}
      {debug && <DebugOverlay sample={sample} extra={debugExtra} />}
    </div>
  );
}

/** Covers the canvas while a diorama swaps underneath. */
function FadeOverlay() {
  const { fading } = useWorldState();
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background: "#05060c",
        opacity: fading ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    />
  );
}
