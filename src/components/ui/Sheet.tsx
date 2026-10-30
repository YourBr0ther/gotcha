"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PixelIcon } from "@/components/pixel/PixelIcon";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Something small to the right of the title, like a balance. */
  aside?: ReactNode;
  children: ReactNode;
  /** Pinned under the scroll area: a primary action, an input row. */
  footer?: ReactNode;
  /** Dims the world behind the sheet. Off for care sheets so the pokemon stays visible. */
  dim?: boolean;
}

/**
 * A bottom sheet over the world. It scrolls inside max-h-[80dvh], leaves
 * the pokemon visible above it, closes on backdrop tap and Escape, and
 * returns focus to where it was opened from.
 */
export function Sheet({ open, onClose, title, aside, children, footer, dim = false }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  // Portal to body: the world container is position fixed and would trap the z-index under the tab bar.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="presentation">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 ${dim ? "bg-black/50" : "bg-transparent"}`}
        style={{ minHeight: 0, minWidth: 0 }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="sheet-enter card card-strong relative flex w-full max-w-lg flex-col rounded-b-none md:rounded-b-[12px] outline-none"
        style={{ maxHeight: "80dvh", paddingBottom: "var(--spacing-safe-bottom)" }}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-white/25 md:hidden" aria-hidden="true" style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)" }} />
          <h2 id={titleId} className="text-lg font-extrabold">
            {title}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {aside}
            <button type="button" onClick={onClose} aria-label="Close" className="flex items-center justify-center rounded-lg text-ink-dim hover:bg-white/10">
              <PixelIcon name="close" size={16} />
            </button>
          </div>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? <div className="border-t border-white/10 px-4 pb-3 pt-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
