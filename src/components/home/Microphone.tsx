"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { useToast } from "@/components/ui/Toast";
import { ApiError, errorText, post } from "@/components/lib/api";

export interface TalkReply {
  line: string;
  emote?: string;
  cry?: boolean;
}

interface Props {
  pokemonId: string;
  onReply: (reply: TalkReply) => void;
  /** Where the button rests before the trainer drags it; CSS pixels from the right and bottom edges. */
  home: { right: number; bottom: number };
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function speechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Round microphone button. Hold to talk: the browser's speech recognition
 * when it has one, otherwise a recording posted to /api/transcribe. The
 * text goes to /api/pokemon/[id]/talk. Either route missing degrades to a
 * toast. Drag it anywhere; a tap without movement is a press.
 */
export function Microphone({ pokemonId, onReply, home }: Props) {
  const { toast } = useToast();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognizer = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const chunks = useRef<Blob[]>([]);
  const button = useRef<HTMLButtonElement>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        toast("Didn't catch that", "info");
        return;
      }
      setBusy(true);
      try {
        const reply = await post<TalkReply>(`/api/pokemon/${pokemonId}/talk`, { text });
        onReply(reply);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) toast("Talking isn't available yet", "info");
        else toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [pokemonId, onReply, toast],
  );

  const transcribe = useCallback(
    async (blob: Blob) => {
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", blob, "speech.webm");
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (res.status === 404) {
          toast("Talking isn't available yet", "info");
          return;
        }
        if (!res.ok) throw new Error(`transcribe ${res.status}`);
        const data = (await res.json()) as { text?: string };
        await send(data.text ?? "");
      } catch (e) {
        toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [send, toast],
  );

  const startRecording = useCallback(async () => {
    const Recognition = speechRecognition();
    if (Recognition) {
      const r = new Recognition();
      r.lang = navigator.language || "en-US";
      r.interimResults = false;
      r.maxAlternatives = 1;
      let text = "";
      r.onresult = (e) => {
        text = e.results[0]?.[0]?.transcript ?? "";
      };
      r.onerror = (e) => {
        if (e.error !== "aborted" && e.error !== "no-speech") toast(`Speech: ${e.error}`, "error");
      };
      r.onend = () => {
        recognizer.current = null;
        setRecording(false);
        if (text) void send(text);
        else toast("Didn't catch that", "info");
      };
      recognizer.current = r;
      try {
        r.start();
        setRecording(true);
      } catch {
        toast("Microphone unavailable", "error");
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("No microphone on this device", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setRecording(false);
        void transcribe(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast("Microphone permission was refused", "error");
    }
  }, [send, transcribe, toast]);

  const stopRecording = useCallback(() => {
    recognizer.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  useEffect(() => () => {
    recognizer.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    button.current?.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;
    d.moved = true;
    const size = 56;
    const x = Math.max(8, Math.min(window.innerWidth - size - 8, d.originX + dx));
    const y = Math.max(8, Math.min(window.innerHeight - size - 8, d.originY + dy));
    setPos({ x, y });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    button.current?.releasePointerCapture(e.pointerId);
    if (!d || d.moved || busy) return;
    if (recording) stopRecording();
    else void startRecording();
  };

  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y }
    : { position: "absolute", right: home.right, bottom: home.bottom };

  return (
    <button
      ref={button}
      type="button"
      aria-label={recording ? "Stop talking" : "Talk to your pokemon"}
      aria-pressed={recording}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
      className={`card flex h-14 w-14 touch-none items-center justify-center rounded-full ${recording ? "recording bg-need-health/60" : "hover:bg-white/10"} ${busy ? "opacity-70" : ""}`}
      style={{ ...style, zIndex: 30 }}
    >
      <PixelIcon name="mic" size={30} />
    </button>
  );
}
