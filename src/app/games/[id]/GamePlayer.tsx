"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Button, Meter, PageHeader } from "@/components/ui/primitives";
import { errorText, get, post, type PokemonView } from "@/components/lib/api";
import type { RoundOutcome, RoundStart } from "@/lib/services/games";
import { GAME_COMPONENTS, type GameManifestData, type GameRoundResult } from "@/games";
import { Countdown } from "@/games/shared/Countdown";
import { Reaction, reactionTier } from "@/games/shared/Reaction";
import { seedFrom } from "@/games/shared/random";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "countdown"; round: RoundStart }
  | { kind: "playing"; round: RoundStart }
  | { kind: "submitting"; round: RoundStart }
  | { kind: "results"; round: RoundStart; result: GameRoundResult; outcome: RoundOutcome };

export function GamePlayer({ manifest }: { manifest: GameManifestData }) {
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const seedParam = params.get("seed");
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // The game reports its result from an animation frame, long after render; the ref is what it reads.
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const [activePokemon, setActivePokemon] = useState<PokemonView | null>(null);
  const Game = GAME_COMPONENTS[manifest.id];

  /** Fetches a round token. Callers that restart set the loading phase first; on mount it already is. */
  const start = useCallback(
    () =>
      post<RoundStart>("/api/games/start", { gameId: manifest.id })
        .then((round) => setPhase({ kind: "countdown", round }))
        .catch((e) => setPhase({ kind: "error", message: errorText(e) })),
    [manifest.id],
  );

  useEffect(() => {
    start();
  }, [start]);

  const restart = useCallback(() => {
    setPhase({ kind: "loading" });
    void start();
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    get<{ pokemon: PokemonView[] }>("/api/pokemon")
      .then((r) => {
        if (!cancelled) setActivePokemon(r.pokemon.find((p) => p.active && p.status === "home") ?? null);
      })
      .catch(() => {
        // The results card falls back to the server's own note of the pokemon.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const begin = useCallback(() => {
    setPhase((p) => (p.kind === "countdown" ? { kind: "playing", round: p.round } : p));
  }, []);

  const finish = useCallback(
    async (result: GameRoundResult) => {
      const p = phaseRef.current;
      if (p.kind !== "playing") return;
      const r = p.round;
      setPhase({ kind: "submitting", round: r });
      try {
        const outcome = await post<RoundOutcome>("/api/games/result", {
          token: r.token,
          gameId: result.gameId,
          score: result.score,
          maxScore: result.maxScore,
          durationMs: result.durationMs,
          perfect: result.perfect,
        });
        setPhase({ kind: "results", round: r, result, outcome });
      } catch (e) {
        setPhase({ kind: "error", message: errorText(e) });
      }
    },
    [],
  );

  const round = "round" in phase ? phase.round : null;
  const seed = seedParam ? Number(seedParam) || 1 : round ? seedFrom(round.roundId) : 1;
  const used = round ? Math.min(round.cap, round.dayTotals.bytesEarned) : 0;

  return (
    <Screen>
      <PageHeader title={manifest.name} back="/games" aside={<PixelIcon name={manifest.icon} size={32} />} />

      {phase.kind === "loading" ? <p className="card px-4 py-6 text-center text-sm text-ink-dim">Getting a round ready...</p> : null}

      {phase.kind === "error" ? (
        <div className="card flex flex-col items-center gap-3 px-4 py-6 text-center" role="alert">
          <p className="text-sm text-danger">{phase.message}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={restart}>
              Try again
            </Button>
            <Link href="/games" className="tap inline-flex items-center justify-center rounded-[12px] bg-white/8 px-4 text-sm font-bold">
              Back
            </Link>
          </div>
        </div>
      ) : null}

      {phase.kind === "countdown" || phase.kind === "playing" || phase.kind === "submitting" ? (
        <>
          <p className="text-xs text-ink-dim">
            A perfect round pays <span className="font-pixel text-bytes">{phase.round.perfectPays.bytes}</span> Bytes right now.{" "}
            <span className="text-ink-faint">
              Today {used} of {phase.round.cap}.
            </span>
          </p>
          <div className="relative">
            {Game ? <Game key={phase.round.roundId} onFinish={finish} active={phase.kind === "playing"} demo={demo} seed={seed} /> : null}
            {phase.kind === "countdown" ? <Countdown onDone={begin} /> : null}
            {phase.kind === "submitting" ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50" role="status">
                <span className="card card-strong px-5 py-3 font-pixel text-base">Scoring...</span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {phase.kind === "results" ? (
        <ResultsCard
          manifest={manifest}
          result={phase.result}
          outcome={phase.outcome}
          pokemon={activePokemon ? { name: activePokemon.name, species: activePokemon.species } : phase.outcome.pokemon}
          onAgain={restart}
        />
      ) : null}
    </Screen>
  );
}

function ResultsCard({
  manifest,
  result,
  outcome,
  pokemon,
  onAgain,
}: {
  manifest: GameManifestData;
  result: GameRoundResult;
  outcome: RoundOutcome;
  pokemon: { name: string; species: string } | null;
  onAgain: () => void;
}) {
  const percent = Math.round(outcome.score * 100);
  const used = Math.min(outcome.cap, outcome.dayTotals.bytesEarned);
  const capped = used >= outcome.cap;
  const tier = reactionTier(outcome.score, outcome.perfect);
  return (
    <section className="card flex flex-col gap-4 px-4 py-5" aria-label="Round results">
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="font-pixel text-[11px] uppercase tracking-wider text-ink-dim">{outcome.perfect ? "Perfect round" : "Round over"}</span>
        <span className="font-pixel text-5xl text-white drop-shadow">{percent}%</span>
        <span className="text-xs text-ink-dim">{detail(manifest.id, result)}</span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="card flex flex-col items-center gap-1 px-3 py-3">
          <PixelIcon name="bytes" size={28} />
          <span className="font-pixel text-2xl text-bytes">+{outcome.bytes}</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-dim">Bytes</span>
        </div>
        <div className="card flex flex-col items-center gap-1 px-3 py-3">
          <PixelIcon name="happy" size={28} />
          <span className="font-pixel text-2xl text-need-happiness">+{outcome.experience}</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-dim">Experience</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Meter value={(used / outcome.cap) * 100} color="var(--color-bytes)" label={`Today's games: ${used} of ${outcome.cap} Bytes`} icon="games" />
        <span className="text-xs text-ink-faint">
          {capped ? "Daily cap reached. Rounds still earn experience until tomorrow." : `${outcome.dayTotals.gamesPlayed} ${outcome.dayTotals.gamesPlayed === 1 ? "round" : "rounds"} today. Each pays a little less than the last.`}
        </span>
      </div>

      {outcome.levelsGained.length > 0 && outcome.pokemon ? (
        <p className="rounded-[10px] bg-need-happiness/15 px-3 py-2 text-center text-sm font-bold text-need-happiness">
          {outcome.pokemon.name} reached level {outcome.levelsGained[outcome.levelsGained.length - 1]}!
        </p>
      ) : null}

      {pokemon ? <Reaction species={pokemon.species} name={pokemon.name} tier={tier} seed={outcome.dayTotals.gamesPlayed} /> : <p className="text-center text-xs text-ink-faint">No active pokemon to cheer you on. Bytes still count.</p>}

      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={onAgain} icon="games">
          Play again
        </Button>
        <Link href="/games" className="tap inline-flex flex-1 items-center justify-center rounded-[12px] bg-white/8 px-4 text-sm font-bold hover:bg-white/14">
          Back
        </Link>
      </div>
    </section>
  );
}

function detail(gameId: string, r: GameRoundResult): string {
  switch (gameId) {
    case "berry-catch":
      return `${r.score} of ${r.maxScore} berries caught`;
    case "whack-a-diglett":
      return `${r.score} of ${r.maxScore} pops whacked`;
    case "type-match":
      return `${Math.round((r.score / r.maxScore) * 100)} of 100 on moves and time`;
    default:
      return `${r.score} of ${r.maxScore}`;
  }
}
