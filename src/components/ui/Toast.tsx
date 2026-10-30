"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";

export type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  toast(text: string, kind?: ToastKind): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), kind === "error" ? 4200 : 2600);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4"
        style={{ bottom: "calc(var(--spacing-tab) + var(--spacing-safe-bottom) + 12px)" }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="toast-enter card card-strong flex max-w-sm items-center gap-2 px-3 py-2 text-sm font-semibold"
          >
            {t.kind === "success" ? (
              <PixelIcon name="check" size={16} className="text-need-happiness" />
            ) : t.kind === "error" ? (
              <PixelIcon name="warn" size={16} className="text-danger" />
            ) : (
              <PixelIcon name="pokeball" size={16} />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs ToastProvider");
  return api;
}
