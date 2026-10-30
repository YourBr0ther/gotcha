/**
 * Current weather for the clock widget. Open-Meteo, no key. Returns
 * `{ tempF, code }` (WMO weather code) when OPEN_METEO_LAT and
 * OPEN_METEO_LON are set and `null` otherwise, so the client draws a sun.
 */

import { connection } from "next/server";

interface OpenMeteo {
  current?: { temperature_2m?: number; weather_code?: number };
}

let cached: { at: number; body: { tempF: number; code: number } | null } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function GET(): Promise<Response> {
  // Read at request time; with cacheComponents a GET that touches nothing from the request would be prerendered.
  await connection();
  const lat = process.env.OPEN_METEO_LAT?.trim();
  const lon = process.env.OPEN_METEO_LON?.trim();
  if (!lat || !lon) return Response.json(null, { headers: { "cache-control": "no-store" } });
  if (cached && Date.now() - cached.at < TTL_MS) return Response.json(cached.body, { headers: { "cache-control": "no-store" } });

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const data = (await res.json()) as OpenMeteo;
    const tempF = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    const body = typeof tempF === "number" && typeof code === "number" ? { tempF: Math.round(tempF), code } : null;
    cached = { at: Date.now(), body };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(cached?.body ?? null, { headers: { "cache-control": "no-store" } });
  }
}
