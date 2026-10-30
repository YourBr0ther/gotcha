import { EPISODIC_KEEP_IMPORTANCE, EPISODIC_KEEP_LINES } from "./constants";
import type { EpisodicEvent } from "./types";

/**
 * The spec's export cut: the most recent 500 events plus everything with
 * importance 3 or higher, in their original order. pack does not apply this
 * itself so a backup can carry everything; the exporter calls it for trades.
 */
export function trimEpisodic(
  events: readonly EpisodicEvent[],
  keepLines = EPISODIC_KEEP_LINES,
  keepImportance = EPISODIC_KEEP_IMPORTANCE,
): EpisodicEvent[] {
  const recentFrom = Math.max(0, events.length - keepLines);
  return events.filter((event, i) => i >= recentFrom || event.importance >= keepImportance);
}
