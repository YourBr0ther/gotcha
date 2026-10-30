import { afterEach, describe, expect, it } from "vitest";
import { POST as transcribeRoute } from "@/app/api/transcribe/route";
import { hasBrowserSpeech, speechRecognitionCtor, transcribeInBrowser } from "./stt";
import { isAcceptedAudio, resetSttProbe, SttUnavailableError, sttUrl, transcribeUpload } from "./stt-server";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetSttProbe();
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("stt", () => {
  it("resolves the endpoint from GOTCHA_STT_URL, then the NanoGPT base, and has none without a key", () => {
    expect(sttUrl({})).toBeNull();
    expect(sttUrl({ NANOGPT_API_KEY: "k" })).toBe("https://nano-gpt.com/api/v1/audio/transcriptions");
    expect(sttUrl({ NANOGPT_API_KEY: "k", NANOGPT_BASE_URL: "https://example.test/v1/" })).toBe("https://example.test/v1/audio/transcriptions");
    expect(sttUrl({ GOTCHA_STT_URL: "http://whisper.local/transcribe" })).toBe("http://whisper.local/transcribe");
    expect(isAcceptedAudio("audio/webm;codecs=opus")).toBe(true);
    expect(isAcceptedAudio("text/plain")).toBe(false);
  });

  it("forwards audio OpenAI-style and returns the text", async () => {
    let seen: { url: string; auth: string | null; fields: string[] } | null = null;
    const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      seen = { url: String(url), auth: new Headers(init?.headers).get("authorization"), fields: [...form.keys()] };
      return new Response(JSON.stringify({ text: " feed the eevee " }), { status: 200 });
    }) as typeof fetch;
    const result = await transcribeUpload(new Blob(["x"], { type: "audio/webm" }), "speech.webm", { fetch: doFetch, env: { NANOGPT_API_KEY: "k" } });
    expect(result).toEqual({ text: "feed the eevee" });
    expect(seen).toEqual({ url: "https://nano-gpt.com/api/v1/audio/transcriptions", auth: "Bearer k", fields: ["file", "model", "response_format"] });
  });

  it("an endpoint that does not exist is remembered as absent for a while", async () => {
    const env = { NANOGPT_API_KEY: "k" };
    await expect(transcribeUpload(new Blob(["x"]), "a.webm", { fetch: fakeFetch(404, {}), env, now: 1000 })).rejects.toBeInstanceOf(SttUnavailableError);
    let called = 0;
    const counting = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await expect(transcribeUpload(new Blob(["x"]), "a.webm", { fetch: counting, env, now: 2000 })).rejects.toBeInstanceOf(SttUnavailableError);
    expect(called).toBe(0);
    await expect(transcribeUpload(new Blob(["x"]), "a.webm", { fetch: fakeFetch(500, {}), env, now: 10 * 60_000 + 2000 })).rejects.toThrow(/500/);
  });

  it("the route answers 501 stt_unavailable with no backend and 400 without audio", async () => {
    delete process.env.NANOGPT_API_KEY;
    delete process.env.GOTCHA_STT_URL;
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "audio/webm" }), "speech.webm");
    const res = await transcribeRoute(new Request("http://x/api/transcribe", { method: "POST", body: form }));
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: "stt_unavailable" });
    const empty = await transcribeRoute(new Request("http://x/api/transcribe", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(empty.status).toBe(400);
  });

  it("the browser helper resolves null when the page has no speech API", async () => {
    expect(speechRecognitionCtor(undefined)).toBeNull();
    expect(speechRecognitionCtor({})).toBeNull();
    expect(hasBrowserSpeech()).toBe(false);
    expect(await transcribeInBrowser()).toBeNull();
  });
});
