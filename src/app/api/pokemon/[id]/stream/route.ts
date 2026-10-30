import { subscribe, type BusMessage } from "@/lib/services/bus";
import { getPokemon } from "@/lib/services/pokemon";
import { startScheduler } from "@/lib/services/scheduler";
import { pokemonView } from "@/lib/services/views";
import { requireUuid, withTrainer } from "../../../_lib/handler";

const STREAM_INTERVAL_MS = 5_000;

/**
 * Server-sent events. `state` carries the decayed view every five seconds
 * and right after a care action or a settle; `brain` carries what the brain
 * chose. The client falls back to GET /api/pokemon/[id] when this drops.
 */
export const GET = withTrainer<{ id: string }>(async (request, { db, trainer }, { id }) => {
  const pokemonId = requireUuid(id);
  await getPokemon(db, trainer.id, pokemonId);
  startScheduler(db);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop();
        }
      };
      const tick = async () => {
        try {
          const row = await getPokemon(db, trainer.id, pokemonId);
          send("state", { view: await pokemonView(row, trainer, new Date().toISOString()), cause: "poll" });
        } catch (error) {
          send("error", { error: (error as Error).message });
          stop();
        }
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      unsubscribe = subscribe(pokemonId, (message: BusMessage) => {
        if (message.type === "state") send("state", { view: message.view, events: message.events ?? [], cause: message.cause ?? "update" });
        else send("brain", message);
      });
      request.signal.addEventListener("abort", stop);
      controller.enqueue(encoder.encode(`retry: 3000\n\n`));
      await tick();
      timer = setInterval(tick, STREAM_INTERVAL_MS);
    },
    cancel() {
      if (timer) clearInterval(timer);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
