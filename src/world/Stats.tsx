"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { loadSummary, type LoadSummary } from "./perf";

export interface StatsSample {
  fps: number;
  calls: number;
  triangles: number;
  dpr: number;
  width: number;
  height: number;
  /** CPU time per frame from the first frame callback to the end of the last render call, averaged over the sample. */
  frameMs: number;
  /** The worst frame in the sample. */
  frameMaxMs: number;
  /** Shader programs the renderer holds. */
  programs: number;
}

/** What `window.__worldStats` holds: the latest sample, the load timings and the overlay's extra line. */
export interface WorldStats extends StatsSample {
  load: LoadSummary;
  extra?: string;
  /** When the sample was taken, ms from navigation. */
  at: number;
}

declare global {
  interface Window {
    __worldStats?: WorldStats;
  }
}

/** Lives inside the Canvas; reports a sample twice a second. */
export function StatsProbe({ onSample }: { onSample: (s: StatsSample) => void }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const frames = useRef(0);
  const last = useRef(0);
  const calls = useRef(0);
  const triangles = useRef(0);
  const frameStart = useRef(0);
  const frameEnd = useRef(0);
  const frameTotal = useRef(0);
  const frameMax = useRef(0);

  // Time each frame from the first callback to the end of the last render.
  // With a post-processing composer the renderer is invoked several times a
  // frame, so the end is the end of whichever call came last.
  useEffect(() => {
    const original = gl.render;
    gl.render = function patched(this: typeof gl, ...args: Parameters<typeof original>) {
      original.apply(this, args);
      frameEnd.current = performance.now();
    } as typeof original;
    return () => {
      gl.render = original;
    };
  }, [gl]);

  // The renderer resets its counters on every render call, and the post
  // chain renders several times a frame, so count the whole frame by hand.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  // Runs first each frame: close the previous frame's measurement, open this one.
  useFrame(() => {
    const now = performance.now();
    if (frameStart.current > 0 && frameEnd.current > frameStart.current) {
      const ms = frameEnd.current - frameStart.current;
      frameTotal.current += ms;
      frameMax.current = Math.max(frameMax.current, ms);
    }
    frameStart.current = now;
    calls.current = Math.max(calls.current, gl.info.render.calls);
    triangles.current = Math.max(triangles.current, gl.info.render.triangles);
    gl.info.reset();
  }, -1000);

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (last.current === 0) last.current = now;
    const elapsed = now - last.current;
    if (elapsed >= 500) {
      onSample({
        fps: (frames.current * 1000) / elapsed,
        calls: calls.current,
        triangles: triangles.current,
        dpr: gl.getPixelRatio(),
        width: size.width,
        height: size.height,
        frameMs: frames.current ? frameTotal.current / frames.current : 0,
        frameMaxMs: frameMax.current,
        programs: gl.info.programs?.length ?? 0,
      });
      frames.current = 0;
      calls.current = 0;
      triangles.current = 0;
      frameTotal.current = 0;
      frameMax.current = 0;
      last.current = now;
    }
  });
  return null;
}

/** Publish a sample on `window.__worldStats`, so a playtest can read the numbers without the DOM. */
export function publishStats(sample: StatsSample, extra?: string): WorldStats {
  const stats: WorldStats = { ...sample, load: loadSummary(), extra, at: Math.round(performance.now()) };
  if (typeof window !== "undefined") window.__worldStats = stats;
  return stats;
}

function ms(v: number | null): string {
  return v === null ? "-" : `${v}ms`;
}

/**
 * DOM overlay; sits outside the Canvas. Top left, under the status bar's
 * safe area, so the app's bottom tab bar never covers it. Press `d` to
 * hide it.
 */
export function DebugOverlay({ sample, extra }: { sample: StatsSample | null; extra?: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!visible) return null;
  const load = loadSummary();
  return (
    <div
      data-testid="world-stats"
      style={{
        position: "absolute",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: "calc(env(safe-area-inset-left, 0px) + 8px)",
        maxWidth: "calc(100% - 16px)",
        padding: "6px 10px",
        background: "rgba(6, 8, 16, 0.92)",
        color: "#eaf0ff",
        font: "10px/1.5 var(--font-pixel, ui-monospace, monospace)",
        textShadow: "0 1px 0 rgba(0,0,0,0.8)",
        borderRadius: 10,
        boxShadow: "0 0 0 1px rgba(255,255,255,0.12)",
        pointerEvents: "none",
        whiteSpace: "pre",
        zIndex: 60,
      }}
    >
      {sample
        ? `fps ${sample.fps.toFixed(0)}  calls ${sample.calls}  tris ${(sample.triangles / 1000).toFixed(1)}k  prog ${sample.programs}\n` +
          `frame ${sample.frameMs.toFixed(1)}ms (max ${sample.frameMaxMs.toFixed(1)})  dpr ${sample.dpr.toFixed(2)}  ${sample.width}x${sample.height}\n` +
          `load bundle ${ms(load.bundleMs)}  build ${ms(load.creatureMs)}  visible ${ms(load.visibleAt)}` +
          (extra ? `\n${extra}` : "")
        : "sampling..."}
    </div>
  );
}
