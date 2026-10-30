"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";

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

/** DOM overlay; sits outside the Canvas. */
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
  return (
    <div
      data-testid="world-stats"
      style={{
        position: "absolute",
        left: 8,
        bottom: 8,
        padding: "6px 8px",
        background: "rgba(10,12,20,0.72)",
        color: "#dfe8ff",
        font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        borderRadius: 6,
        pointerEvents: "none",
        whiteSpace: "pre",
        zIndex: 10,
      }}
    >
      {sample
        ? `fps ${sample.fps.toFixed(0)}  draw calls ${sample.calls}  tris ${(sample.triangles / 1000).toFixed(1)}k\n` +
          `frame ${sample.frameMs.toFixed(1)}ms (max ${sample.frameMaxMs.toFixed(1)})  dpr ${sample.dpr.toFixed(2)}  ${sample.width}x${sample.height}` +
          (extra ? `\n${extra}` : "")
        : "sampling..."}
    </div>
  );
}
