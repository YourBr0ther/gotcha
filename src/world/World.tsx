"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldHandle } from "./api";
import { Creature } from "./Creature";
import { DayNight } from "./DayNight";
import { Diorama } from "./Diorama";
import { FixedCamera } from "./FixedCamera";
import { DebugOverlay, publishStats, StatsProbe, type StatsSample } from "./Stats";
import { Ambient } from "./Ambient";
import { createWorldStore, FADE_MS } from "./store";
import { Effects } from "./Effects";
import { useWorldState, useWorldStore, WorldStoreContext } from "./WorldContext";
import { mark } from "./perf";

export interface WorldProps {
  /** Receives the imperative handle once the store exists. */
  onReady?: (handle: WorldHandle) => void;
  /** Show the fps and draw-call overlay. Defaults to `?debug=1` in the page URL. */
  debug?: boolean;
  /** Extra text for the overlay's third line. */
  debugExtra?: string;
  /** The post chain (depth of field, bloom, anti-aliasing), the painted backdrop and weather particles. Default on; off for a slow device. */
  depth?: boolean;
  /** A creature is on its way: the first render waits longer for it, so its shaders compile with the scene's in one go. */
  expectCreature?: boolean;
  /** Anything to float over the world, like the HUD. */
  children?: ReactNode;
  className?: string;
}

/** The post chain waits this long for a creature that was asked for, and this long for one that was not. */
const POST_CHAIN_WAIT_MS = 8000;
const POST_CHAIN_IDLE_MS = 1500;

/**
 * Mounts the post chain only after the active creature has drawn its first
 * frame. Its shaders are the most expensive compile of the scene's first
 * render, and compiling them before the creature exists keeps the creature
 * off screen for that long; after it, the compile is one hitch behind a
 * pokemon that is already there.
 */
function PostChain() {
  const { bundle, loadToken, shownToken, depth } = useWorldState();
  // Once on, stays on: the next pokemon swap must not unmount the chain.
  const [latched, setLatched] = useState(false);
  const shown = loadToken > 0 && shownToken === loadToken;
  const on = latched || shown;
  useEffect(() => {
    if (latched) return;
    const timer = setTimeout(() => setLatched(true), shown ? 0 : bundle ? POST_CHAIN_WAIT_MS : POST_CHAIN_IDLE_MS);
    return () => clearTimeout(timer);
  }, [latched, shown, bundle]);
  return depth && on ? <Effects /> : null;
}

/**
 * How long the first render waits for the creature. The scene's first
 * render compiles every shader it meets, and a creature that arrives a
 * moment later pays a second compile of its own; on a slow phone each is a
 * long freeze, so the first frame holds until the creature is in the scene
 * graph and the renderer has compiled the lot off the render path. While
 * the hold is on the frame loop is off, which also leaves the main thread
 * free for the creature's own files to arrive and parse.
 */
const FIRST_RENDER_HOLD_MS = 1500;
const FIRST_RENDER_HOLD_FOR_CREATURE_MS = 6000;

/** True until the first creature is attached and compiled, or the hold runs out. */
function useFirstRenderHold(expectCreature: boolean): boolean {
  const { compiledToken } = useWorldState();
  const [expired, setExpired] = useState(false);
  const [mountedAt] = useState(() => performance.now());
  const cap = expectCreature ? FIRST_RENDER_HOLD_FOR_CREATURE_MS : FIRST_RENDER_HOLD_MS;
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, mountedAt + cap - performance.now()));
    return () => clearTimeout(timer);
  }, [expired, mountedAt, cap]);
  // Only the very first creature is worth waiting for; later swaps render
  // into a live scene. compiledToken only ever grows, so once any creature
  // has compiled the hold is over for good.
  return !expired && compiledToken === 0;
}

function debugFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
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
export default function World({ onReady, debug, debugExtra, depth = true, expectCreature = false, children, className }: WorldProps) {
  const store = useMemo(() => createWorldStore(), []);

  useEffect(() => {
    onReady?.(store.handle);
  }, [onReady, store]);
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => store.setDepth(depth), [store, depth]);

  return (
    <WorldStoreContext.Provider value={store}>
      <WorldView debug={debug} debugExtra={debugExtra} expectCreature={expectCreature} className={className}>
        {children}
      </WorldView>
    </WorldStoreContext.Provider>
  );
}

function WorldView({ debug, debugExtra, expectCreature = false, children, className }: Omit<WorldProps, "onReady" | "depth">) {
  const store = useWorldStore();
  const visible = useDocumentVisible();
  const holding = useFirstRenderHold(expectCreature);
  const [urlDebug] = useState(debugFromUrl);
  const showDebug = debug ?? urlDebug;
  const [sample, setSample] = useState<StatsSample | null>(null);
  const onSample = useCallback((s: StatsSample) => setSample(s), []);
  useEffect(() => {
    if (sample) publishStats(sample, debugExtra);
  }, [sample, debugExtra]);

  return (
    <div className={className} style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none" }}>
      <Canvas
        dpr={[1, 2]}
        frameloop={visible && !holding ? "always" : "never"}
        shadows="soft"
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        camera={{ fov: 50, near: 0.1, far: 80, position: [0.9, 1.35, 4.4] }}
        style={{ position: "absolute", inset: 0 }}
        onCreated={() => mark("canvas-created")}
      >
        <WorldStoreContext.Provider value={store}>
          <FixedCamera />
          <DayNight />
          <Diorama />
          <Creature />
          <Ambient />
          <PostChain />
          {showDebug && <StatsProbe onSample={onSample} />}
        </WorldStoreContext.Provider>
      </Canvas>
      <FadeOverlay holding={holding} />
      {children}
      {showDebug && <DebugOverlay sample={sample} extra={debugExtra} />}
    </div>
  );
}

/** Covers the canvas while a diorama swaps underneath, and before the first frame. */
function FadeOverlay({ holding }: { holding: boolean }) {
  const { fading } = useWorldState();
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background: "#05060c",
        opacity: fading || holding ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    />
  );
}
