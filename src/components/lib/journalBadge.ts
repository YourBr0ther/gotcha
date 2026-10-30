/**
 * The journal badge: lit when the pokemon has a memory newer than the last
 * time this browser opened the journal. Tracked per pokemon in localStorage.
 */

import type { Memories } from "@gotcha/cpkmn";

const KEY = (id: string) => `gotcha.journal.seen.${id}`;

export function latestEntryAt(memories: Memories | undefined): string | null {
  if (!memories) return null;
  let latest: string | null = null;
  for (const e of memories.episodic) if (!latest || e.ts > latest) latest = e.ts;
  return latest;
}

export function hasUnread(id: string, memories: Memories | undefined): boolean {
  const latest = latestEntryAt(memories);
  if (!latest) return false;
  try {
    const seen = localStorage.getItem(KEY(id));
    return !seen || latest > seen;
  } catch {
    return false;
  }
}

export function markRead(id: string, memories: Memories | undefined): void {
  const latest = latestEntryAt(memories) ?? new Date().toISOString();
  try {
    localStorage.setItem(KEY(id), latest);
  } catch {
    // Private mode; the badge just stays lit.
  }
}
