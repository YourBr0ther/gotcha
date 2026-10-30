/**
 * Server side of speech to text: forwards audio to an OpenAI-style
 * /audio/transcriptions endpoint. GOTCHA_STT_URL names it outright;
 * otherwise it is NANOGPT_BASE_URL plus /audio/transcriptions, which may
 * or may not exist on the subscription (open question in the design doc).
 * An endpoint that answers 404, 405 or 501 is remembered as absent for a
 * while so every tap does not hit it again.
 */

export class SttUnavailableError extends Error {
  readonly code = "stt_unavailable" as const;
  constructor(message: string) {
    super(message);
    this.name = "SttUnavailableError";
  }
}

export const ACCEPTED_AUDIO = ["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp4", "audio/m4a"] as const;

/** How long a probe that found no endpoint is trusted. */
export const STT_RECHECK_MS = 10 * 60_000;

let absentUntil = 0;

/** Env lookups take a plain record so tests can pass a few keys. */
export type Env = Record<string, string | undefined>;

export function sttUrl(env: Env = process.env): string | null {
  const explicit = env.GOTCHA_STT_URL?.trim();
  if (explicit) return explicit;
  if (!env.NANOGPT_API_KEY?.trim()) return null;
  const base = (env.NANOGPT_BASE_URL?.trim() || "https://nano-gpt.com/api/v1").replace(/\/+$/, "");
  return `${base}/audio/transcriptions`;
}

export function sttModel(env: Env = process.env): string {
  return env.GOTCHA_STT_MODEL?.trim() || "whisper-1";
}

export function resetSttProbe(): void {
  absentUntil = 0;
}

export interface TranscribeDeps {
  fetch?: typeof fetch;
  env?: Env;
  now?: number;
}

export function isAcceptedAudio(type: string | null | undefined): boolean {
  if (!type) return false;
  const base = type.split(";")[0].trim().toLowerCase();
  return (ACCEPTED_AUDIO as readonly string[]).includes(base);
}

/** Sends the audio on and returns the text. Throws SttUnavailableError when nothing can transcribe. */
export async function transcribeUpload(audio: Blob, filename: string, deps: TranscribeDeps = {}): Promise<{ text: string }> {
  const env: Env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  const url = sttUrl(env);
  if (!url) throw new SttUnavailableError("no transcription backend: set NANOGPT_API_KEY or GOTCHA_STT_URL");
  if (now < absentUntil) throw new SttUnavailableError("the transcription endpoint answered that it does not exist; retrying later");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", sttModel(env));
  form.append("response_format", "json");
  const headers: Record<string, string> = {};
  const key = env.NANOGPT_API_KEY?.trim();
  if (key) headers.authorization = `Bearer ${key}`;

  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    absentUntil = now + STT_RECHECK_MS;
    throw new SttUnavailableError(`the transcription endpoint at ${url} answered ${res.status}`);
  }
  if (!res.ok) throw new Error(`transcription failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { text?: unknown };
  return { text: typeof body.text === "string" ? body.text.trim() : "" };
}
