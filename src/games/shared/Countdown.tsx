"use client";

import { useEffect, useState } from "react";
import { useHidden } from "./clock";

const STEPS = 3;

/** 3, 2, 1, Go over the board. Holds while the tab is hidden so nobody loses the start. */
export function Countdown({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(STEPS);
  const hidden = useHidden();

  useEffect(() => {
    if (hidden) return;
    const id = setTimeout(() => {
      if (step <= 0) onDone();
      else setStep(step - 1);
    }, step <= 0 ? 450 : 1000);
    return () => clearTimeout(id);
  }, [step, hidden, onDone]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45" role="status" aria-live="assertive">
      <span key={step} className="countdown-pop font-pixel text-7xl font-bold text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">
        {step > 0 ? step : "Go!"}
      </span>
      <style>{`
        @keyframes countdown-pop { 0% { transform: scale(1.6); opacity: 0 } 30% { transform: scale(1); opacity: 1 } 100% { transform: scale(0.95); opacity: 1 } }
        .countdown-pop { animation: countdown-pop 900ms cubic-bezier(0.2, 0.8, 0.2, 1) }
        @media (prefers-reduced-motion: reduce) { .countdown-pop { animation: none } }
      `}</style>
    </div>
  );
}
