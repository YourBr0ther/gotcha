"use client";

import { useEffect, useMemo, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { Button, PageHeader, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, patch, type Me } from "@/components/lib/api";
import { readLowPower, writeLowPower } from "@/components/lib/prefs";

function zones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
  } catch {
    return ["UTC"];
  }
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [tz, setTz] = useState("");
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => zones(), []);
  const [lowPower, setLowPower] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  if (!prefsLoaded && typeof window !== "undefined") {
    setPrefsLoaded(true);
    setLowPower(readLowPower());
  }
  const device = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    get<Me>("/api/me")
      .then((m) => {
        setMe(m);
        setTz(m.timezone);
      })
      .catch((e) => toast(errorText(e), "error"));
  }, [toast]);

  const save = async (zone: string) => {
    setBusy(true);
    try {
      const r = await patch<{ timezone: string }>("/api/me", { timezone: zone });
      setTz(r.timezone);
      setMe((m) => (m ? { ...m, timezone: r.timezone } : m));
      toast(`Timezone is ${r.timezone}`, "success");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageHeader title="Settings" back="/more" />
      <section className="card flex flex-col gap-3 p-4" aria-labelledby="tz-title">
        <h2 id="tz-title" className="text-base font-extrabold">
          Timezone
        </h2>
        <p className="text-xs text-ink-dim">Night in the diorama and the daily care stipend follow this clock.</p>
        {!me ? (
          <Skeleton className="h-11" />
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-bold">Zone</span>
              <select value={tz} onChange={(e) => setTz(e.target.value)} className="h-11 rounded-[10px] bg-white/10 px-3 text-base outline-none ring-white/30 focus:ring-2">
                {!all.includes(tz) && tz ? <option value={tz}>{tz}</option> : null}
                {all.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || tz === me.timezone} onClick={() => void save(tz)}>
                Save
              </Button>
              <Button variant="ghost" disabled={busy || device === me.timezone} onClick={() => void save(device)}>
                Use this device&apos;s ({device})
              </Button>
            </div>
          </>
        )}
      </section>
      <section className="card flex flex-col gap-2 p-4" aria-labelledby="power-title">
        <h2 id="power-title" className="text-base font-extrabold">
          Performance
        </h2>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={lowPower}
            onChange={(e) => {
              setLowPower(e.target.checked);
              writeLowPower(e.target.checked);
            }}
            className="h-5 w-5 accent-need-happiness"
          />
          <span className="flex flex-col">
            <span className="font-bold">Low power mode</span>
            <span className="text-xs text-ink-dim">Hides the wild pokemon in the background. Takes effect next time Home opens.</span>
          </span>
        </label>
      </section>
      <section className="card flex flex-col gap-2 p-4" aria-labelledby="install-title">
        <h2 id="install-title" className="text-base font-extrabold">
          Install
        </h2>
        <p className="text-xs text-ink-dim">On iPhone: Share, then Add to Home Screen. On Android: the browser menu, then Install app. It opens full screen with the status bar dark.</p>
        {me ? <p className="font-pixel text-xs text-ink-faint">Signed in as {me.username}</p> : null}
      </section>
    </Screen>
  );
}
