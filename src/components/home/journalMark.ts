/**
 * The journal badge mark: the newest journal timestamp this browser has
 * seen, per pokemon, in localStorage. The badge lights when the route's
 * `newestAt` is newer than the mark. Same key the earlier memories-based
 * badge used, so existing marks carry over.
 */

const KEY = (id: string) => `gotcha.journal.seen.${id}`;

export function hasUnread(id: string, newestAt: string | null | undefined): boolean {
  if (!newestAt) return false;
  try {
    const seen = localStorage.getItem(KEY(id));
    return !seen || newestAt > seen;
  } catch {
    return false;
  }
}

export function markRead(id: string, newestAt: string | null | undefined): void {
  try {
    localStorage.setItem(KEY(id), newestAt ?? new Date().toISOString());
  } catch {
    // Private mode; the badge just stays lit.
  }
}
