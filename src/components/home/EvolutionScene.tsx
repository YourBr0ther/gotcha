"use client";

import { Button } from "@/components/ui/primitives";
import { titleCase } from "@/components/lib/format";

export type EvolutionStage = "glow" | "reveal" | "failed";

export interface Evolving {
  name: string;
  from: string;
  to: string;
  stage: EvolutionStage;
  bytes: number;
}

/**
 * The moment. The world goes dark, white light pulses over the pokemon
 * and the box says what every trainer has read: it is evolving. When the
 * new form is in the scene the light flares out and the box says who it
 * became, with the cry under it. A tap closes it.
 */
export function EvolutionScene({ evolving, onDone }: { evolving: Evolving; onDone: () => void }) {
  const { name, to, stage, bytes } = evolving;
  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-label={stage === "reveal" ? `${name} evolved` : `${name} is evolving`}>
      <div className={`absolute inset-0 bg-[#05060c] transition-opacity duration-700 ${stage === "glow" ? "opacity-70" : "opacity-0"}`} />
      {stage === "glow" ? <div className="evo-pulse absolute inset-0" /> : null}
      {stage === "reveal" ? <div className="evo-flash absolute inset-0" /> : null}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-3" style={{ paddingBottom: "calc(var(--spacing-safe-bottom) + 24px)" }}>
        <div className="card card-strong w-full max-w-lg px-4 py-3">
          <span className="block font-pixel text-[11px] uppercase tracking-wider text-ink-dim">{stage === "reveal" ? "Congratulations" : "What?"}</span>
          <span className="font-pixel block text-[15px] leading-relaxed">
            {stage === "glow" ? `${name} is evolving!` : stage === "reveal" ? `${name} evolved into ${titleCase(to)}!` : `${name} stopped evolving.`}
          </span>
          {stage === "reveal" && bytes > 0 ? <span className="mt-1 block font-pixel text-xs text-bytes">+{bytes} Bytes</span> : null}
        </div>
        {stage !== "glow" ? (
          <Button variant="primary" onClick={onDone} className="h-12 px-6">
            {stage === "reveal" ? `Hello, ${name}` : "Okay"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
