"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js once the page has loaded. The build id rides on
 * the script URL so each deploy gets its own caches. Set
 * NEXT_PUBLIC_BUILD_ID at build time (the image build does); without it
 * the worker still works but keeps one cache across deploys. Skipped in
 * development and on localhost, where a cached shell only gets in the way.
 */
export function RegisterSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return;
    const version = process.env.NEXT_PUBLIC_BUILD_ID || process.env.NEXT_PUBLIC_APP_VERSION || "1";
    const register = () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" }).catch(() => {
        // Offline shell is a nicety; the app works without it.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
