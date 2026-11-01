/**
 * What the API hands out for a pokemon: the row decayed to `now`, the mood,
 * and the needs, without writing anything. GET and the stream use this;
 * care and the scheduler persist through care.settle.
 */

import type { Needs, Pokedex, State, Stats } from "@gotcha/cpkmn";
import { decay, evolutionProspects, mood, MINUTE, type ActiveModifier, type EvolutionRule, type Mood } from "@/lib/sim";
import type { PokemonRow, PokemonStatus, TrainerRow } from "@/lib/db/schema";
import { getSpecies, listSpecies, speciesFacts } from "./species";

export interface PokemonView {
  id: string;
  trainerId: string;
  species: string;
  name: string;
  nickname: string | null;
  nationalDex: number;
  aspects: string[];
  shiny: boolean;
  gender: string;
  level: number;
  status: PokemonStatus;
  slot: number | null;
  active: boolean;
  box: number | null;
  boxSlot: number | null;
  state: State;
  needs: Needs;
  mood: Mood;
  stats: Stats;
  modifiers: ActiveModifier[];
  /** Evolutions the pokemon could ask about now; item rules are listed even without the item so the ask can name it. */
  evolution: { options: EvolutionRule[]; blocked: boolean; declinedUntil: string | null };
  /** The species snapshot the file carries. Memories stay off the view; the journal route serves them. */
  pokedex: Pokedex;
  now: string;
}

export interface ActivePokemonSummary {
  id: string;
  species: string;
  name: string;
  nickname: string | null;
  level: number;
  mood: Mood["label"];
  activity: string;
  asleep: boolean;
  diorama: string;
}

/** Minutes east of UTC for an IANA timezone at `now`. Unknown zones count as UTC. */
export function utcOffsetMinutes(timezone: string, now: string): number {
  try {
    const date = new Date(now);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - date.getTime()) / MINUTE);
  } catch {
    return 0;
  }
}

/** YYYY-MM-DD in the trainer's timezone. */
export function localDay(timezone: string, now: string): string {
  const offset = utcOffsetMinutes(timezone, now);
  return new Date(new Date(now).getTime() + offset * MINUTE).toISOString().slice(0, 10);
}

export function liveModifiers(modifiers: readonly ActiveModifier[], now: string): ActiveModifier[] {
  const nowMs = Date.parse(now);
  return modifiers.filter((m) => Date.parse(m.until) > nowMs);
}

export function displayName(row: Pick<PokemonRow, "identity" | "pokedex">): string {
  return row.identity.nickname?.trim() || titleCase(row.identity.species);
}

function titleCase(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The row moved forward to now, in memory only. */
export async function decayedState(row: PokemonRow, now: string): Promise<{ state: State; events: ReturnType<typeof decay>["events"] }> {
  const record = await getSpecies(row.identity.species);
  // Stasis: in_transit and pc rows do not decay on read.
  if (row.status !== "home") return { state: { ...row.state }, events: [] };
  return decay(row.state, row.personality, speciesFacts(record), now, liveModifiers(row.modifiers, now));
}

export async function pokemonView(row: PokemonRow, trainer: Pick<TrainerRow, "timezone">, now: string): Promise<PokemonView> {
  const record = await getSpecies(row.identity.species);
  const { state } = await decayedState(row, now);
  // Only an evolution the install can draw is worth asking about.
  const have = new Set(await listSpecies());
  const m = mood(state, speciesFacts(record), now, { utcOffsetMinutes: utcOffsetMinutes(trainer.timezone, now) });
  return {
    id: row.id,
    trainerId: row.trainerId,
    species: row.identity.species,
    name: displayName(row),
    nickname: row.identity.nickname ?? null,
    nationalDex: row.identity.nationalDex,
    aspects: row.identity.aspects,
    shiny: row.identity.shiny,
    gender: row.identity.gender,
    level: row.stats.level,
    status: row.status,
    slot: row.slot,
    active: row.active,
    box: row.box,
    boxSlot: row.boxSlot,
    state,
    needs: state.needs,
    mood: m,
    stats: row.stats,
    modifiers: liveModifiers(row.modifiers, now),
    evolution: {
      options: row.status === "home" ? evolutionProspects(row.stats, speciesFacts(record), now).filter((r) => have.has(r.to)) : [],
      blocked: row.stats.evolution.blocked,
      declinedUntil: row.stats.evolution.declinedUntil ?? null,
    },
    pokedex: row.pokedex,
    now,
  };
}

export async function activeSummary(row: PokemonRow, trainer: Pick<TrainerRow, "timezone">, now: string): Promise<ActivePokemonSummary> {
  const view = await pokemonView(row, trainer, now);
  return {
    id: view.id,
    species: view.species,
    name: view.name,
    nickname: view.nickname,
    level: view.level,
    mood: view.mood.label,
    activity: view.state.activity,
    asleep: view.state.asleep,
    diorama: view.state.location.diorama,
  };
}
