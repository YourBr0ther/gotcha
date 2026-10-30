/**
 * Per-process event bus for live state. The stream route subscribes per
 * pokemon; care and the scheduler publish after their transaction commits.
 * One pod, so in-process is enough. Kept on globalThis so dev-mode module
 * instances share it.
 */

import type { EngineEvent } from "@/lib/sim";
import type { PokemonView } from "./views";

export type BusMessage =
  | { type: "state"; view: PokemonView; events?: EngineEvent[]; cause?: string }
  | { type: "brain"; pokemonId: string; activity?: string; emote?: string; dialogue?: string; cry?: boolean; at: string };

type Listener = (message: BusMessage) => void;

interface Bus {
  listeners: Map<string, Set<Listener>>;
}

const KEY = Symbol.for("gotcha.bus");

function bus(): Bus {
  const holder = globalThis as { [KEY]?: Bus };
  holder[KEY] ??= { listeners: new Map() };
  return holder[KEY];
}

export function subscribe(pokemonId: string, listener: Listener): () => void {
  const b = bus();
  let set = b.listeners.get(pokemonId);
  if (!set) {
    set = new Set();
    b.listeners.set(pokemonId, set);
  }
  set.add(listener);
  return () => {
    const current = b.listeners.get(pokemonId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) b.listeners.delete(pokemonId);
  };
}

export function publish(pokemonId: string, message: BusMessage): void {
  const set = bus().listeners.get(pokemonId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(message);
    } catch {
      // A broken subscriber must not stop the others.
    }
  }
}

/** How many streams are open for this pokemon. The scheduler reads this. */
export function watcherCount(pokemonId: string): number {
  return bus().listeners.get(pokemonId)?.size ?? 0;
}

export function watchedPokemonIds(): string[] {
  return [...bus().listeners.keys()];
}
