"use client";

import { useCallback, useRef, useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import type { GameProps } from "../types";
import { useGameLoop } from "../shared/clock";
import { GameFrame, secondsLeft, Stat } from "../shared/GameFrame";
import { mulberry32 } from "../shared/random";
import { dealCards, FLIP_BACK_MS, isOver, PAIRS, scoreRound, TIME_LIMIT_MS, type TypeName } from "./rules";
import { TypeIcon } from "./TypeIcon";
import { manifest } from "./manifest";

const DEMO_STEP_MS = 900;

interface Sim {
  cards: TypeName[];
  up: number[];
  matched: boolean[];
  moves: number;
  found: number;
  flipBackAt: number | null;
  nextDemoAt: number;
  elapsed: number;
  done: boolean;
}

interface Frame {
  cards: TypeName[];
  up: number[];
  matched: boolean[];
  moves: number;
  found: number;
  elapsed: number;
}

function createSim(seed: number): Sim {
  const cards = dealCards(mulberry32(seed));
  return { cards, up: [], matched: cards.map(() => false), moves: 0, found: 0, flipBackAt: null, nextDemoAt: 900, elapsed: 0, done: false };
}

function snapshot(s: Sim): Frame {
  return { cards: s.cards, up: [...s.up], matched: [...s.matched], moves: s.moves, found: s.found, elapsed: s.elapsed };
}

export default function TypeMatch({ onFinish, active = true, demo = false, seed = 1 }: GameProps) {
  const sim = useRef<Sim | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [over, setOver] = useState(false);

  const flip = useCallback((index: number) => {
    const s = sim.current;
    if (!s || s.done || s.matched[index] || s.up.includes(index) || s.up.length >= 2) return;
    s.up.push(index);
    if (s.up.length === 2) {
      s.moves += 1;
      const [a, b] = s.up;
      if (s.cards[a] === s.cards[b]) {
        s.matched[a] = true;
        s.matched[b] = true;
        s.found += 1;
        s.up = [];
      } else {
        s.flipBackAt = s.elapsed + FLIP_BACK_MS;
      }
    }
    setFrame(snapshot(s));
  }, []);

  const onFrame = useCallback(
    (elapsed: number) => {
      const s = (sim.current ??= createSim(seed));
      if (s.done) return;
      s.elapsed = elapsed;

      if (s.flipBackAt !== null && elapsed >= s.flipBackAt) {
        s.up = [];
        s.flipBackAt = null;
      }
      if (demo && elapsed >= s.nextDemoAt && s.up.length < 2 && s.flipBackAt === null) {
        // The demo knows the deal: flip the first unmatched card, then its twin.
        const first = s.up[0] ?? s.matched.findIndex((m) => !m);
        const target = s.up.length === 0 ? first : s.cards.findIndex((c, i) => c === s.cards[first] && i !== first && !s.matched[i]);
        if (target >= 0) flip(target);
        s.nextDemoAt = elapsed + DEMO_STEP_MS;
      }

      setFrame(snapshot(s));

      if (isOver(s.found, elapsed)) {
        s.done = true;
        setOver(true);
        const { score, maxScore, perfect } = scoreRound({ matched: s.found, moves: s.moves, elapsedMs: elapsed });
        onFinish({ gameId: manifest.id, score, maxScore, durationMs: Math.round(elapsed), perfect });
      }
    },
    [demo, flip, onFinish, seed],
  );

  const { paused } = useGameLoop(active && !over, onFrame);
  const view = frame ?? { cards: [], up: [], matched: [], moves: 0, found: 0, elapsed: 0 };

  return (
    <GameFrame
      paused={paused}
      areaStyle={{ background: "linear-gradient(180deg, #2c3e50 0%, #1f2a38 100%)", touchAction: "manipulation" }}
      hud={
        <>
          <Stat label="Pairs">
            {view.found}/{PAIRS}
          </Stat>
          <Stat label="Moves">{view.moves}</Stat>
          <Stat label="Time">{secondsLeft(TIME_LIMIT_MS, view.elapsed)}s</Stat>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-2 p-3" role="group" aria-label="Sixteen face-down cards. Find the eight matching pairs.">
        {view.cards.length === 0
          ? Array.from({ length: PAIRS * 2 }).map((_, i) => <div key={i} className="aspect-square min-h-[64px] rounded-[12px] bg-white/10" aria-hidden="true" />)
          : view.cards.map((type, i) => {
              const faceUp = view.matched[i] || view.up.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onPointerDown={() => flip(i)}
                  disabled={view.matched[i]}
                  aria-label={faceUp ? `${type} card` : "Face-down card"}
                  aria-pressed={faceUp}
                  className={`relative aspect-square min-h-[64px] rounded-[12px] shadow-[inset_0_-3px_0_rgb(0_0_0/0.3)] transition-transform duration-150 ${faceUp ? "" : "card-back active:scale-95"} ${view.matched[i] ? "opacity-80 ring-2 ring-white/60" : ""}`}
                  style={{ background: faceUp ? `var(--color-type-${type})` : "rgb(255 255 255 / 0.12)", touchAction: "manipulation" }}
                >
                  <span className="flex h-full w-full items-center justify-center">
                    {faceUp ? <TypeIcon type={type} size={44} /> : <PixelIcon name="pokeball" size={30} className="opacity-50" />}
                  </span>
                  {faceUp ? <span className="absolute inset-x-0 bottom-1 text-center font-pixel text-[9px] uppercase tracking-wider text-black/70">{type}</span> : null}
                </button>
              );
            })}
      </div>
    </GameFrame>
  );
}
