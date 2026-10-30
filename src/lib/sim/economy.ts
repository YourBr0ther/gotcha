/**
 * Bytes, the one currency. Earned by care (a daily stipend), mini-games on
 * a diminishing daily curve, and milestones. Never bought.
 */

import type { Needs } from "@gotcha/cpkmn";
import { NEED_NAMES } from "@gotcha/cpkmn";
import {
  MILESTONE_BYTES,
  MINIGAME_BASE_BYTES,
  MINIGAME_BASE_EXPERIENCE,
  MINIGAME_DAILY_CAP,
  MINIGAME_FLOOR,
  MINIGAME_HALF_LIFE_GAMES,
  STIPEND_FULL_CARE_BONUS,
  STIPEND_MAX,
  STIPEND_THRESHOLD,
} from "./constants";
import type { DayTotals, MilestoneKind, MiniGameResult } from "./types";
import { clamp } from "./util";

/**
 * Pays for the share of the day each need spent above the stipend
 * threshold, from needs sampled across the day. Everything above all day
 * earns a bonus. No samples, no stipend.
 */
export function dailyStipend(stateHistory: readonly Needs[]): number {
  if (stateHistory.length === 0) return 0;
  let share = 0;
  let allAbove = true;
  for (const need of NEED_NAMES) {
    let above = 0;
    for (const needs of stateHistory) {
      if (needs[need] >= STIPEND_THRESHOLD) above += 1;
      else allAbove = false;
    }
    share += above / stateHistory.length;
  }
  share /= NEED_NAMES.length;
  return Math.round(STIPEND_MAX * share) + (allAbove ? STIPEND_FULL_CARE_BONUS : 0);
}

/** Multiplier applied to the next mini-game after `gamesPlayed` today. */
export function miniGameMultiplier(gamesPlayed: number): number {
  return Math.max(MINIGAME_FLOOR, 1 / (1 + Math.max(0, gamesPlayed) / MINIGAME_HALF_LIFE_GAMES));
}

export interface Payout {
  bytes: number;
  experience: number;
}

export function miniGamePayout(result: MiniGameResult, dayTotals: DayTotals): Payout {
  const score = clamp(Number.isFinite(result.score) ? result.score : 0, 0, 1) * (result.completed ? 1 : 0.5);
  const multiplier = miniGameMultiplier(dayTotals.gamesPlayed);
  const room = Math.max(0, MINIGAME_DAILY_CAP - dayTotals.bytesEarned);
  const bytes = Math.min(room, Math.round(MINIGAME_BASE_BYTES * score * multiplier));
  const experience = Math.round(MINIGAME_BASE_EXPERIENCE * score * multiplier);
  return { bytes, experience };
}

export function milestoneBonus(kind: MilestoneKind): number {
  return MILESTONE_BYTES[kind];
}
