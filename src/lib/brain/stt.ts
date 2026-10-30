/**
 * Speech to text for the microphone button, client side. The browser's
 * Web Speech API is tried first (free, private, works on iOS and Android);
 * when it is missing the caller records audio and posts it to
 * /api/transcribe, which forwards to NanoGPT when that is configured. The
 * UI never needs to know which path answered. No env, no node imports:
 * this file is bundled for the browser.
 */

export interface BrowserTranscribeOptions {
  lang?: string;
  /** Give up after this long without a result. */
  timeoutMs?: number;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function speechRecognitionCtor(win: unknown = typeof window === "undefined" ? undefined : window): SpeechRecognitionCtor | null {
  const w = win as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

/** True when this browser can transcribe on its own. */
export function hasBrowserSpeech(): boolean {
  return speechRecognitionCtor() !== null;
}

/**
 * Listens once and resolves with the transcript. Resolves null when the
 * browser has no speech API, so the caller can record and post instead.
 * Rejects on a recognition error other than silence.
 */
export function transcribeInBrowser(options: BrowserTranscribeOptions = {}): Promise<string | null> {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = options.lang ?? (typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US");
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let settled = false;
    let text = "";
    const timer = setTimeout(() => {
      if (!settled) rec.stop();
    }, options.timeoutMs ?? 10_000);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    rec.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) parts.push(event.results[i][0]?.transcript ?? "");
      text = parts.join(" ").trim();
    };
    rec.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return finish(() => resolve(""));
      finish(() => reject(new Error(`speech recognition failed: ${event.error ?? "unknown"}`)));
    };
    rec.onend = () => finish(() => resolve(text));
    try {
      rec.start();
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

export interface ServerTranscribeResult {
  text: string | null;
  /** Set when the server has no transcription backend. */
  unavailable: boolean;
}

/** Posts a recording (webm, ogg or wav) to /api/transcribe. */
export async function transcribeOnServer(audio: Blob, filename = "speech.webm"): Promise<ServerTranscribeResult> {
  const form = new FormData();
  form.append("file", audio, filename);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (res.status === 501) return { text: null, unavailable: true };
  if (!res.ok) throw new Error(`transcribe failed with ${res.status}`);
  const body = (await res.json()) as { text?: string };
  return { text: body.text ?? "", unavailable: false };
}

/**
 * The one call the microphone button makes. Browser first; when the
 * browser cannot, `record` is asked for audio and the server is tried.
 * Null means no path could transcribe and the UI should offer typing.
 */
export async function transcribe(record?: () => Promise<Blob | null>, options: BrowserTranscribeOptions = {}): Promise<string | null> {
  const local = await transcribeInBrowser(options);
  if (local !== null) return local;
  if (!record) return null;
  const audio = await record();
  if (!audio) return null;
  const result = await transcribeOnServer(audio, audio.type.includes("ogg") ? "speech.ogg" : audio.type.includes("wav") ? "speech.wav" : "speech.webm");
  return result.unavailable ? null : result.text;
}
