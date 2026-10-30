"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { WorldState } from "./api";
import type { WorldStore } from "./store";

export const WorldStoreContext = createContext<WorldStore | null>(null);

export function useWorldStore(): WorldStore {
  const store = useContext(WorldStoreContext);
  if (!store) throw new Error("useWorldStore must be used inside <World>");
  return store;
}

export function useWorldState(): WorldState {
  const store = useWorldStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
