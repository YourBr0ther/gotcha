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
}

/** Lives inside the Canvas; reports a sample twice a second. */
export function StatsProbe({ onSample }: { onSample: (s: StatsSample) => void }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const frames = useRef(0);
  const last = useRef(0);
  const calls = useRef(0);
  const triangles = useRef(0);

  useFrame(() => {
    frames.current++;
    // info is reset at the start of each render, so this is the last full frame.
    calls.current = Math.max(calls.current, gl.info.render.calls);
    triangles.current = Math.max(triangles.current, gl.info.render.triangles);
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
      });
      frames.current = 0;
      calls.current = 0;
      triangles.current = 0;
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
          `dpr ${sample.dpr.toFixed(2)}  ${sample.width}x${sample.height}` +
          (extra ? `\n${extra}` : "")
        : "sampling..."}
    </div>
  );
}
