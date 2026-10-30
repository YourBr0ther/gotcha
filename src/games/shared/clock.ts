"use client";

/**
 * One requestAnimationFrame loop per game. Elapsed time only advances
 * while the round is running and the tab is visible, so a backgrounded
 * phone pauses the round instead of losing it.
 */

import { useEffect, useRef, useState } from "react";

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function useHidden(): boolean {
  const [hidden, setHidden] = useState(isHidden);
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

export interface GameLoop {
  /** Milliseconds of play so far, excluding pauses. */
  elapsed: number;
  paused: boolean;
}

/** Calls onFrame with the running elapsed time each animation frame while `running` and the tab is visible. */
export function useGameLoop(running: boolean, onFrame: (elapsedMs: number, dtMs: number) => void): GameLoop {
  const hidden = useHidden();
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const frame = useRef(onFrame);
  useEffect(() => {
    frame.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!running || hidden) return;
    let last: number | null = null;
    let id = 0;
    const tick = (t: number) => {
      // The first frame after a resume carries no time, so a pause costs nothing.
      const dt = last === null ? 0 : Math.min(50, Math.max(0, t - last));
      last = t;
      elapsedRef.current += dt;
      frame.current(elapsedRef.current, dt);
      setElapsed(elapsedRef.current);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running, hidden]);

  return { elapsed, paused: running && hidden };
}
