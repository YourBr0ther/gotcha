"use client";

import { useEffect } from "react";
import { get, patch, type Me } from "@/components/lib/api";

const KEY = "gotcha.tz.synced";

/**
 * A trainer starts on UTC and nothing set the real zone unless they found
 * the Settings page, so night, the stipend day and the diary's days all
 * ran on UTC. Once per browser session, when the account still says UTC
 * and the device says otherwise, the device zone goes up. A zone someone
 * picked by hand is never UTC by accident, so it is left alone.
 */
export function TimezoneSync() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch {
      // Private mode: sync once per page load instead.
    }
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!device || device === "UTC") return;
    let alive = true;
    get<Me>("/api/me")
      .then(async (me) => {
        if (!alive || me.timezone !== "UTC") return;
        await patch("/api/me", { timezone: device });
      })
      .catch(() => undefined)
      .finally(() => {
        try {
          sessionStorage.setItem(KEY, "1");
        } catch {
          // Nothing to remember with; the next load tries again, which is cheap.
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
