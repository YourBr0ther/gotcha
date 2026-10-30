"use client";

import { useEffect, useState } from "react";

interface Props {
  speaker: string;
  text: string | null;
  onDone: () => void;
}

/**
 * The one Pokemon-game text box in the app: Monocraft, typed reveal, tap to
 * finish the reveal and tap again to dismiss. Closes by itself a while
 * after the text is fully shown.
 */
export function DialogueBox({ speaker, text, onDone }: Props) {
  const [shown, setShown] = useState(0);
  const [shownFor, setShownFor] = useState<string | null>(text);
  if (shownFor !== text) {
    setShownFor(text);
    setShown(0);
  }
  const complete = text !== null && shown >= text.length;

  useEffect(() => {
    if (!text) return;
    const id = setInterval(() => setShown((n) => Math.min(text.length, n + 1)), 28);
    return () => clearInterval(id);
  }, [text]);

  useEffect(() => {
    if (!complete) return;
    const id = setTimeout(onDone, 6000);
    return () => clearTimeout(id);
  }, [complete, onDone]);

  if (!text) return null;

  return (
    <button
      type="button"
      onClick={() => (complete ? onDone() : setShown(text.length))}
      className="card card-strong w-full max-w-lg px-4 py-3 text-left"
      aria-live="polite"
      style={{ minHeight: 64 }}
    >
      <span className="block font-pixel text-[11px] uppercase tracking-wider text-ink-dim">{speaker}</span>
      <span className="font-pixel block text-[15px] leading-relaxed">
        {text.slice(0, shown)}
        {complete ? <span className="ml-1 inline-block animate-pulse">{"▼"}</span> : null}
      </span>
    </button>
  );
}
