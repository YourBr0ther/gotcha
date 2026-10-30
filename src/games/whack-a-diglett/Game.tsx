"use client";

import { useCallback, useRef, useState } from "react";
import type { GameProps } from "../types";
import { useGameLoop } from "../shared/clock";
import { GameFrame, secondsLeft, Stat } from "../shared/GameFrame";
import { mulberry32 } from "../shared/random";
import { Diglett, Dugtrio } from "./Diglett";
import { canPop, gapAt, HIT_LINGER_MS, HOLES, isDugtrio, nextHole, popWindowAt, ROUND_MS, scoreRound } from "./rules";
import { manifest } from "./manifest";

const DEMO_REACTION_MS = 380;

interface Pop {
  hole: number;
  at: number;
  until: number;
  dugtrio: boolean;
  hitAt: number | null;
}

interface Sim {
  random: () => number;
  pop: Pop | null;
  nextPopAt: number;
  lastHole: number | null;
  hits: number;
  pops: number;
  dugtrioHits: number;
  elapsed: number;
  done: boolean;
}

interface Frame {
  pop: Pop | null;
  hits: number;
  pops: number;
  elapsed: number;
}

function createSim(seed: number): Sim {
  return { random: mulberry32(seed), pop: null, nextPopAt: 500, lastHole: null, hits: 0, pops: 0, dugtrioHits: 0, elapsed: 0, done: false };
}

const EMPTY: Frame = { pop: null, hits: 0, pops: 0, elapsed: 0 };

export default function WhackADiglett({ onFinish, active = true, demo = false, seed = 1 }: GameProps) {
  const sim = useRef<Sim | null>(null);
  const [frame, setFrame] = useState<Frame>(EMPTY);
  const [over, setOver] = useState(false);

  const whack = useCallback((hole: number) => {
    const s = sim.current;
    if (!s || s.done || !s.pop || s.pop.hole !== hole || s.pop.hitAt !== null) return;
    s.pop.hitAt = s.elapsed;
    s.hits += 1;
    if (s.pop.dugtrio) s.dugtrioHits += 1;
    setFrame({ pop: { ...s.pop }, hits: s.hits, pops: s.pops, elapsed: s.elapsed });
  }, []);

  const onFrame = useCallback(
    (elapsed: number) => {
      const s = (sim.current ??= createSim(seed));
      if (s.done) return;
      s.elapsed = elapsed;

      if (s.pop) {
        const hitDone = s.pop.hitAt !== null && elapsed >= s.pop.hitAt + HIT_LINGER_MS;
        const missed = s.pop.hitAt === null && elapsed >= s.pop.until;
        if (hitDone || missed) {
          s.pop = null;
          s.nextPopAt = elapsed + gapAt(elapsed);
        } else if (demo && s.pop.hitAt === null && elapsed >= s.pop.at + DEMO_REACTION_MS) {
          whack(s.pop.hole);
        }
      }
      if (!s.pop && elapsed >= s.nextPopAt && canPop(elapsed)) {
        const hole = nextHole(s.lastHole, s.random());
        s.lastHole = hole;
        s.pop = { hole, at: elapsed, until: elapsed + popWindowAt(elapsed), dugtrio: isDugtrio(elapsed, s.random()), hitAt: null };
        s.pops += 1;
      }

      setFrame({ pop: s.pop ? { ...s.pop } : null, hits: s.hits, pops: s.pops, elapsed });

      if (elapsed >= ROUND_MS) {
        s.done = true;
        setOver(true);
        const { score, maxScore, perfect } = scoreRound({ hits: s.hits, pops: s.pops, dugtrioHits: s.dugtrioHits });
        onFinish({ gameId: manifest.id, score, maxScore, durationMs: Math.round(elapsed), perfect });
      }
    },
    [demo, onFinish, seed, whack],
  );

  const { paused } = useGameLoop(active && !over, onFrame);

  return (
    <GameFrame
      paused={paused}
      areaStyle={{ background: "linear-gradient(180deg, #6bb04a 0%, #4f8f38 100%)", touchAction: "manipulation" }}
      hud={
        <>
          <Stat label="Hits">{frame.hits}</Stat>
          <Stat label="Pops">{frame.pops}</Stat>
          <Stat label="Time">{secondsLeft(ROUND_MS, frame.elapsed)}s</Stat>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 p-3" role="group" aria-label="Nine holes. Tap a Diglett when it pops up.">
        {Array.from({ length: HOLES }).map((_, hole) => {
          const up = frame.pop?.hole === hole ? frame.pop : null;
          const hit = up?.hitAt !== null && up?.hitAt !== undefined;
          return (
            <button
              key={hole}
              type="button"
              onPointerDown={() => whack(hole)}
              className="relative aspect-square min-h-[88px] overflow-hidden rounded-[14px] bg-[#3f7a3a]/70 shadow-[inset_0_-3px_0_rgb(0_0_0/0.25)] active:brightness-110"
              aria-label={up ? (up.dugtrio ? "Dugtrio" : "Diglett") : "Empty hole"}
              style={{ touchAction: "manipulation" }}
            >
              <span className="absolute bottom-[14%] left-1/2 h-[28%] w-[64%] -translate-x-1/2 rounded-[50%] bg-[#2a1708]/85" aria-hidden="true" />
              {up ? (
                <span className="absolute bottom-[18%] left-1/2 -translate-x-1/2 diglett-pop" aria-hidden="true">
                  {up.dugtrio ? <Dugtrio size={78} hit={hit} /> : <Diglett size={56} hit={hit} />}
                </span>
              ) : null}
              {hit ? (
                <span className="absolute left-1/2 top-2 -translate-x-1/2 font-pixel text-sm text-bytes drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]" aria-hidden="true">
                  {up?.dugtrio ? "+2" : "+1"}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <style>{`
        @keyframes diglett-pop { from { transform: translate(-50%, 60%) } to { transform: translate(-50%, 0) } }
        .diglett-pop { animation: diglett-pop 110ms ease-out }
        @media (prefers-reduced-motion: reduce) { .diglett-pop { animation: none } }
      `}</style>
    </GameFrame>
  );
}
