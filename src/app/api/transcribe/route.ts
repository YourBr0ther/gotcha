import { isAcceptedAudio, SttUnavailableError, transcribeUpload } from "@/lib/brain/stt-server";
import { json, plain } from "../_lib/handler";

/** Largest recording accepted, bytes. A minute of webm opus is well under this. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

function nameFor(type: string): string {
  const base = type.split(";")[0].trim().toLowerCase();
  if (base.includes("ogg")) return "speech.ogg";
  if (base.includes("wav")) return "speech.wav";
  if (base.includes("mpeg")) return "speech.mp3";
  if (base.includes("mp4") || base.includes("m4a")) return "speech.m4a";
  return "speech.webm";
}

/**
 * POST audio as multipart (`file`) or as the raw body with an audio
 * content type. Answers { text }, or 501 { error, code: "stt_unavailable" }
 * when no backend can transcribe so the client falls back to typing.
 */
export const POST = plain(async (request) => {
  // Refuse oversized uploads before buffering them. The size check on the
  // parsed blob below still applies to chunked requests without a length.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 64 * 1024) {
    return json({ error: "recording too large", code: "bad_request" }, { status: 413 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  let audio: Blob | null = null;
  let filename = "speech.webm";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") ?? form.get("audio");
    if (file instanceof Blob) {
      audio = file;
      filename = (file as File).name || nameFor(file.type);
    }
  } else if (isAcceptedAudio(contentType)) {
    audio = await request.blob();
    filename = nameFor(contentType);
  }
  if (!audio || audio.size === 0) return json({ error: "send audio as multipart `file` or as the body with an audio content type", code: "bad_request" }, { status: 400 });
  if (audio.type && !isAcceptedAudio(audio.type)) return json({ error: `unsupported audio type ${audio.type}`, code: "bad_request" }, { status: 415 });
  if (audio.size > MAX_AUDIO_BYTES) return json({ error: "recording too large", code: "bad_request" }, { status: 413 });

  try {
    return json(await transcribeUpload(audio, filename));
  } catch (error) {
    if (error instanceof SttUnavailableError) return json({ error: error.message, code: error.code }, { status: 501 });
    throw error;
  }
});
