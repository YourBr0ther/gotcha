"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import type { GameProps } from "../types";
import { useGameLoop } from "../shared/clock";
import { GameFrame, secondsLeft, Stat } from "../shared/GameFrame";
import { PixelGlyph, type GlyphMap } from "../shared/PixelGlyph";
import { mulberry32 } from "../shared/random";
import { BASKET_SPEED, BASKET_WIDTH, BERRY_WIDTH, canSpawn, CATCH_Y, fallDurationAt, isCaught, isOver, MAX_MISSES, ROUND_MS, scoreRound, spawnIntervalAt, spawnX } from "./rules";
import { manifest } from "./manifest";

const TINTS = [
  { b: "#4a6cf0", B: "#8fa6ff" },
  { b: "#e5322d", B: "#ff8a80" },
  { b: "#ff8ab8", B: "#ffc2d9" },
  { b: "#f2c230", B: "#ffe58a" },
  { b: "#5ad64b", B: "#a6f09a" },
  { b: "#8a4ad8", B: "#c49cff" },
];

const BASKET: GlyphMap = {
  rows: [
    ".....######.....",
    "....#......#....",
    "...#........#...",
    "..#..........#..",
    "#w############w#",
    ".#wbwbwbwbwbwb#.",
    ".#bwbwbwbwbwbw#.",
    ".#wbwbwbwbwbwb#.",
    "..#bwbwbwbwbw#..",
    "..#wbwbwbwbwb#..",
    "...##########...",
  ],
  palette: { "#": "#4a2c12", w: "#d9a066", b: "#b5792f" },
};

interface Berry {
  id: number;
  x: number;
  startAt: number;
  fallMs: number;
  tint: number;
}

interface Sim {
  random: () => number;
  berries: Berry[];
  basketX: number;
  targetX: number;
  caught: number;
  missed: number;
  nextSpawnAt: number;
  nextId: number;
  /** Elapsed at the last catch, for the little flash on the basket. */
  flashAt: number;
  done: boolean;
}

interface Frame {
  berries: { id: number; x: number; y: number; tint: number }[];
  basketX: number;
  caught: number;
  missed: number;
  elapsed: number;
  flash: boolean;
}

function createSim(seed: number): Sim {
  return { random: mulberry32(seed), berries: [], basketX: 0.5, targetX: 0.5, caught: 0, missed: 0, nextSpawnAt: 600, nextId: 1, flashAt: -1, done: false };
}

const EMPTY: Frame = { berries: [], basketX: 0.5, caught: 0, missed: 0, elapsed: 0, flash: false };

export default function BerryCatch({ onFinish, active = true, demo = false, seed = 1 }: GameProps) {
  const sim = useRef<Sim | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame>(EMPTY);
  const [over, setOver] = useState(false);

  const onFrame = useCallback(
    (elapsed: number, dt: number) => {
      const s = (sim.current ??= createSim(seed));
      if (s.done) return;

      if (demo) {
        let lowest: Berry | null = null;
        let lowestY = -1;
        for (const b of s.berries) {
          const y = (elapsed - b.startAt) / b.fallMs;
          if (y > lowestY) {
            lowestY = y;
            lowest = b;
          }
        }
        if (lowest) s.targetX = lowest.x;
      }

      const step = (BASKET_SPEED * dt) / 1000;
      const dx = s.targetX - s.basketX;
      s.basketX = Math.abs(dx) <= step ? s.targetX : s.basketX + Math.sign(dx) * step;
      const half = BASKET_WIDTH / 2;
      s.basketX = Math.max(half, Math.min(1 - half, s.basketX));

      if (elapsed >= s.nextSpawnAt && canSpawn(elapsed)) {
        s.berries.push({ id: s.nextId++, x: spawnX(s.random()), startAt: elapsed, fallMs: fallDurationAt(elapsed), tint: Math.floor(s.random() * TINTS.length) });
        s.nextSpawnAt = elapsed + spawnIntervalAt(elapsed);
      }

      const live: Berry[] = [];
      for (const b of s.berries) {
        const y = (elapsed - b.startAt) / b.fallMs;
        if (y < CATCH_Y) {
          live.push(b);
          continue;
        }
        if (isCaught(b.x, s.basketX)) {
          s.caught += 1;
          s.flashAt = elapsed;
        } else s.missed += 1;
      }
      s.berries = live;

      setFrame({
        berries: live.map((b) => ({ id: b.id, x: b.x, y: (elapsed - b.startAt) / b.fallMs, tint: b.tint })),
        basketX: s.basketX,
        caught: s.caught,
        missed: s.missed,
        elapsed,
        flash: elapsed - s.flashAt < 180,
      });

      if (isOver(s.missed, elapsed, live.length)) {
        s.done = true;
        setOver(true);
        const { score, maxScore, perfect } = scoreRound({ caught: s.caught, missed: s.missed });
        onFinish({ gameId: manifest.id, score, maxScore, durationMs: Math.round(elapsed), perfect });
      }
    },
    [demo, onFinish, seed],
  );

  const { paused } = useGameLoop(active && !over, onFrame);

  const steer = (e: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    const box = area.current?.getBoundingClientRect();
    if (!s || !box || box.width === 0) return;
    s.targetX = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    steer(e);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 && e.pointerType !== "touch") return;
    steer(e);
  };

  return (
    <GameFrame
      paused={paused}
      height="clamp(340px, calc(100dvh - 330px), 540px)"
      areaProps={{ onPointerDown, onPointerMove, role: "application", "aria-label": "Berry Catch. Tap or drag to move the basket." }}
      areaStyle={{ background: "linear-gradient(180deg, #5fa8e0 0%, #87c9a2 55%, #6bb04a 84%, #3f7a3a 86%, #28491f 100%)" }}
      hud={
        <>
          <Stat label="Caught">{frame.caught}</Stat>
          <span className="flex items-center gap-0.5" aria-label={`${MAX_MISSES - frame.missed} misses left`}>
            {Array.from({ length: MAX_MISSES }).map((_, i) => (
              <PixelIcon key={i} name={i < MAX_MISSES - frame.missed ? "heart" : "heartEmpty"} size={16} />
            ))}
          </span>
          <Stat label="Time">{secondsLeft(ROUND_MS, frame.elapsed)}s</Stat>
        </>
      }
    >
      <div ref={area} className="absolute inset-0">
        {frame.berries.map((b) => (
          <div key={b.id} className="absolute" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${BERRY_WIDTH * 100}%`, transform: "translate(-50%, -50%)" }}>
            <PixelIcon name="berry" size={999} tint={TINTS[b.tint]} className="h-auto w-full" style={{ width: "100%", height: "auto" }} />
          </div>
        ))}
        <div
          className="absolute"
          style={{ left: `${frame.basketX * 100}%`, top: `${CATCH_Y * 100}%`, width: `${BASKET_WIDTH * 100}%`, transform: `translate(-50%, -45%) ${frame.flash ? "scale(1.08)" : ""}` }}
        >
          <PixelGlyph glyph={BASKET} size={999} style={{ width: "100%", height: "auto" }} />
        </div>
      </div>
    </GameFrame>
  );
}
