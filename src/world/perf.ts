/**
 * Load-time instrumentation. Every stage of getting a creature on screen
 * leaves a `performance.mark` / `performance.measure` under the `world:`
 * prefix, so a playtest can read the breakdown from
 * `performance.getEntriesByType("measure")` or from `window.__worldStats`.
 * No-ops outside a browser.
 */

const hasPerf = typeof performance !== "undefined" && typeof performance.mark === "function";

export function mark(name: string): void {
  if (hasPerf) performance.mark(`world:${name}`);
}

/** Record `name` as the span from mark `from` (or `from` ms) to now. */
export function measure(name: string, from: string | number): number {
  if (!hasPerf) return 0;
  const start = typeof from === "number" ? from : (performance.getEntriesByName(`world:${from}`, "mark").pop()?.startTime ?? performance.now());
  const end = performance.now();
  try {
    performance.measure(`world:${name}`, { start, end });
  } catch {
    // An old browser without the options form; the number still comes back.
  }
  return end - start;
}

export function now(): number {
  return hasPerf ? performance.now() : Date.now();
}

/** Time an async stage. */
export async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = now();
  try {
    return await run();
  } finally {
    measure(name, start);
  }
}

/** Time a sync stage. */
export function timedSync<T>(name: string, run: () => T): T {
  const start = now();
  try {
    return run();
  } finally {
    measure(name, start);
  }
}

export interface LoadSummary {
  /** When the canvas had a GL context, ms from navigation. */
  canvasAt: number | null;
  /** Fetching the bundle (index, manifest, files), ms. */
  bundleMs: number | null;
  /** Building the creature from the bundle (textures, geometry, clips), ms. */
  creatureMs: number | null;
  /** When the active creature's first frame began, ms from navigation. */
  firstFrameAt: number | null;
  /** When that frame had rendered, shaders compiled; the creature is on screen. */
  visibleAt: number | null;
}

function lastMeasure(name: string): number | null {
  if (!hasPerf) return null;
  const entries = performance.getEntriesByName(`world:${name}`, "measure");
  return entries.length ? Math.round(entries[entries.length - 1].duration) : null;
}

function lastMark(name: string): number | null {
  if (!hasPerf) return null;
  const entries = performance.getEntriesByName(`world:${name}`, "mark");
  return entries.length ? Math.round(entries[entries.length - 1].startTime) : null;
}

/** The load timings so far, for the overlay and `window.__worldStats`. */
export function loadSummary(): LoadSummary {
  return {
    canvasAt: lastMark("canvas-created"),
    bundleMs: lastMeasure("bundle"),
    creatureMs: lastMeasure("creature:load"),
    firstFrameAt: lastMark("creature-first-frame"),
    visibleAt: lastMark("creature-visible"),
  };
}
