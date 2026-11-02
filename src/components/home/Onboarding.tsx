"use client";

import { useState } from "react";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { Button } from "@/components/ui/primitives";
import { sentence } from "@/components/lib/format";

/**
 * The first run. Before a trainer has a pokemon the world is empty and
 * this card is what they see: a welcome by name and one button into the
 * starter picker. Once they have picked, a short tour of three cards
 * sits where the dialogue box goes, each one about a thing on screen:
 * petting and the meters, the care row, the morning Bytes and the
 * journal. It shows once, right after the pick.
 */
export function Welcome({ name, onStart, inPc }: { name: string | null; onStart: () => void; inPc: number }) {
  return (
    <div className="card card-strong flex flex-col items-center gap-3 px-6 py-6 text-center">
      <span className="bob">
        <PixelIcon name="pokeball" size={56} />
      </span>
      {inPc > 0 ? (
        <>
          <p className="text-lg font-extrabold">Nobody is home</p>
          <p className="max-w-xs text-sm text-ink-dim">Your pokemon are all in the PC. Withdraw one to bring it back to the meadow.</p>
          <a href="/pc" className="tap inline-flex h-12 items-center rounded-[12px] bg-need-happiness px-5 font-bold text-black">
            Open the PC
          </a>
        </>
      ) : (
        <>
          <p className="text-lg font-extrabold">{name ? `Welcome, ${sentence(name)}.` : "Welcome."}</p>
          <p className="max-w-xs text-sm text-ink-dim">This corner of the pokemon world is yours. Someone is waiting to meet you.</p>
          <Button variant="primary" onClick={onStart} className="h-12 px-5 text-base">
            Meet your pokemon
          </Button>
        </>
      )}
    </div>
  );
}

interface TourStep {
  icon: PixelIconName;
  text: (name: string) => string;
}

const STEPS: TourStep[] = [
  { icon: "heart", text: (n) => `This is ${n}. Tap ${n} to pet. The meters up top show how ${n} is feeling.` },
  { icon: "apple", text: (n) => `Feed, Play, Groom and Rest are what ${n} needs from you. Bag holds your food and toys, and the store is inside it.` },
  { icon: "bytes", text: (n) => `Every morning you get Bytes for the care you gave. ${n} writes a diary page each night; the journal is top right.` },
];

export function Tour({ name, onDone }: { name: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="card card-strong w-full max-w-lg px-4 py-3" role="dialog" aria-label="Getting started">
      <div className="flex items-start gap-3">
        <PixelIcon name={s.icon} size={28} className="mt-0.5 shrink-0" />
        <p className="font-pixel text-[14px] leading-relaxed">{s.text(name)}</p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex gap-1" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-white" : "bg-white/30"}`} />
          ))}
        </span>
        <Button variant="primary" onClick={() => (last ? onDone() : setStep(step + 1))}>
          {last ? "Let's go" : "Next"}
        </Button>
      </div>
    </div>
  );
}
