/**
 * Care actions. Call decay() first so the state is current as of `now`;
 * careAction applies the action at `now` and does not move lastTickAt.
 */

import type { IsoDate, NeedName, State } from "@gotcha/cpkmn";
import { NEED_NAMES } from "@gotcha/cpkmn";
import { CARE, CARE_EXPERIENCE, CARE_FRIENDSHIP, CARE_MISTAKE_FRIENDSHIP, NEED_MAX, RECOVERY_LOW } from "./constants";
import { clearSickness } from "./decay";
import { milestoneBonus } from "./economy";
import type { ActiveModifier, CareAction, EngineEvent, StoreItem } from "./types";
import { clampNeed, cloneState, parseIso, toIso } from "./util";

export interface CareResult {
  state: State;
  events: EngineEvent[];
  /** Bytes earned by this action (milestones only; care has no wage). */
  bytes: number;
  experience: number;
  /** Base friendship change, scaled by growth.adjustFriendship. */
  friendship: number;
  mistake: boolean;
  /** Set when a toy was used; the caller stores it and passes it to decay(). */
  modifier?: ActiveModifier;
  /** True when the pokemon refused and nothing changed. */
  refused: boolean;
}

export const CARE_ACTIONS: readonly CareAction[] = ["feed", "play", "groom", "rest", "wake", "medicine", "discipline", "pet"];

function fill(s: State, amounts: Partial<Record<NeedName, number>>): void {
  for (const need of NEED_NAMES) {
    const amount = amounts[need];
    if (amount) s.needs[need] = clampNeed(s.needs[need] + amount);
  }
}

export function careAction(state: State, action: CareAction, item: StoreItem | null, now: IsoDate): CareResult {
  parseIso(now);
  const s = cloneState(state);
  const events: EngineEvent[] = [];
  const before = { ...state.needs };
  let mistake = false;
  let refused = false;
  let modifier: ActiveModifier | undefined;
  const mistakeNow = (detail: string) => {
    mistake = true;
    s.careMistakes += 1;
    events.push({ kind: "care_mistake", at: now, detail });
  };

  switch (action) {
    case "feed": {
      if (!item?.effects.fill?.hunger) throw new Error("feed needs a food item");
      if (s.asleep) {
        refused = true;
        events.push({ kind: "refused", at: now, detail: "asleep" });
        break;
      }
      if (s.needs.hunger >= CARE.feed.overfeedThreshold) {
        mistakeNow("overfed");
        s.needs.hygiene = clampNeed(s.needs.hygiene - CARE.feed.overfeedHygieneDrop);
        s.lastMessAt = now;
        events.push({ kind: "mess", at: now, need: "hygiene" });
      }
      fill(s, item.effects.fill);
      fill(s, { affection: CARE.feed.affection });
      break;
    }
    case "play": {
      if (s.asleep) {
        mistakeNow("woken_to_play");
        s.asleep = false;
        s.sleepStartedAt = null;
        events.push({ kind: "woke_up", at: now, detail: "play" });
      }
      const tired = s.needs.energy < CARE.play.tiredEnergy;
      const funGain = (CARE.play.fun + (item?.effects.fill?.fun ?? 0)) * (tired ? 0.5 : 1);
      fill(s, { fun: funGain, affection: CARE.play.affection });
      if (item?.effects.fill) fill(s, { ...item.effects.fill, fun: 0 });
      fill(s, { energy: -CARE.play.energyCost, hunger: -CARE.play.hungerCost, hygiene: -CARE.play.hygieneCost });
      if (item?.effects.modifier) {
        const m = item.effects.modifier;
        modifier = { need: m.need, factor: m.factor, until: toIso(parseIso(now) + m.duration), source: item.id };
      }
      break;
    }
    case "groom": {
      if (s.asleep) {
        refused = true;
        events.push({ kind: "refused", at: now, detail: "asleep" });
        break;
      }
      fill(s, { hygiene: CARE.groom.hygiene, affection: CARE.groom.affection });
      break;
    }
    case "rest": {
      if (s.asleep) {
        refused = true;
        events.push({ kind: "refused", at: now, detail: "already_asleep" });
        break;
      }
      if (s.needs.energy >= CARE.rest.refuseEnergy) {
        refused = true;
        events.push({ kind: "refused", at: now, detail: "not_tired" });
        break;
      }
      s.asleep = true;
      s.sleepStartedAt = now;
      events.push({ kind: "fell_asleep", at: now, detail: "put_to_bed" });
      break;
    }
    case "wake": {
      if (!s.asleep) {
        refused = true;
        events.push({ kind: "refused", at: now, detail: "already_awake" });
        break;
      }
      if (s.needs.energy < CARE.wake.safeEnergy) {
        mistakeNow("woken_early");
        fill(s, { affection: -CARE.wake.affectionPenalty });
      }
      s.asleep = false;
      s.sleepStartedAt = null;
      events.push({ kind: "woke_up", at: now, detail: "trainer" });
      break;
    }
    case "medicine": {
      if (!s.sickness) {
        mistakeNow("medicine_when_healthy");
        fill(s, { affection: -CARE.medicine.unneededAffectionPenalty });
        break;
      }
      clearSickness(s, parseIso(now), events, item ? item.id : "medicine");
      fill(s, { health: CARE.medicine.health });
      if (item?.effects.fill) fill(s, item.effects.fill);
      break;
    }
    case "discipline": {
      if (s.flags?.misbehaving) {
        s.flags = { ...s.flags, misbehaving: false };
        fill(s, { affection: -CARE.discipline.affectionCost });
      } else {
        mistakeNow("unjust_discipline");
        fill(s, { affection: -CARE.discipline.unjustAffectionPenalty });
      }
      break;
    }
    case "pet": {
      if (s.asleep) {
        refused = true;
        events.push({ kind: "refused", at: now, detail: "asleep" });
        break;
      }
      fill(s, { affection: CARE.pet.affection, fun: CARE.pet.fun });
      break;
    }
    default: {
      const never: never = action;
      throw new Error(`Unknown care action: ${String(never)}`);
    }
  }

  if (refused) return { state: s, events, bytes: 0, experience: 0, friendship: 0, mistake: false, refused };

  let bytes = 0;
  for (const need of NEED_NAMES) {
    if (before[need] < RECOVERY_LOW && s.needs[need] >= NEED_MAX) {
      bytes += milestoneBonus("recovery");
      events.push({ kind: "milestone", at: now, need, detail: "recovery" });
    }
  }
  events.push({ kind: "care", at: now, detail: action });
  const friendship = CARE_FRIENDSHIP[action] + (mistake ? CARE_MISTAKE_FRIENDSHIP : 0);
  const result: CareResult = { state: s, events, bytes, experience: CARE_EXPERIENCE[action], friendship, mistake, refused };
  if (modifier) result.modifier = modifier;
  return result;
}
