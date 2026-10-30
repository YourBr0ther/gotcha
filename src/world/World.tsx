"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import type { WorldHandle } from "./api";
import { Creature } from "./Creature";
import { DayNight } from "./DayNight";
import { Diorama } from "./Diorama";
import { FixedCamera } from "./FixedCamera";
import { DebugOverlay, StatsProbe, type StatsSample } from "./Stats";
import { createWorldStore } from "./store";
import { WorldStoreContext } from "./WorldContext";

export interface WorldProps {
  /** Receives the imperative handle once the store exists. */
  onReady?: (handle: WorldHandle) => void;
  /** Show the fps and draw-call overlay. */
  debug?: boolean;
  /** Extra text for the overlay's third line. */
  debugExtra?: string;
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
export default function World({ onReady, debug = false, debugExtra, children, className }: WorldProps) {
  const store = useMemo(() => createWorldStore(), []);
  const visible = useDocumentVisible();
  const [sample, setSample] = useState<StatsSample | null>(null);
  const onSample = useCallback((s: StatsSample) => setSample(s), []);

  useEffect(() => {
    onReady?.(store.handle);
  }, [onReady, store]);

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
          {debug && <StatsProbe onSample={onSample} />}
        </WorldStoreContext.Provider>
      </Canvas>
      {children}
      {debug && <DebugOverlay sample={sample} extra={debugExtra} />}
    </div>
  );
}
