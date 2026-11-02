/**
 * Shared pokemon row helpers: loading with ownership, locking inside a
 * transaction, and turning engine events into episodic log rows.
 */

import { and, eq, sql } from "drizzle-orm";
import type { EpisodicEvent, EventKind } from "@gotcha/cpkmn";
import type { EngineEvent } from "@/lib/sim";
import { schema, type DbOrTx } from "@/lib/db";
import type { NewEventRow, PokemonRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { displayName } from "./views";

export const PARTY_SIZE = 6;
export const BOX_SIZE = 30;

export async function getPokemon(db: DbOrTx, trainerId: string, pokemonId: string): Promise<PokemonRow> {
  const row = await db.query.pokemon.findFirst({ where: and(eq(schema.pokemon.id, pokemonId), eq(schema.pokemon.trainerId, trainerId)) });
  if (!row || row.status === "released") throw new ServiceError("not_found", "pokemon not found");
  return row;
}

/** Row lock for the rest of the transaction. */
export async function lockPokemon(tx: DbOrTx, trainerId: string, pokemonId: string): Promise<PokemonRow> {
  const [row] = await tx
    .select()
    .from(schema.pokemon)
    .where(and(eq(schema.pokemon.id, pokemonId), eq(schema.pokemon.trainerId, trainerId)))
    .for("update");
  if (!row || row.status === "released") throw new ServiceError("not_found", "pokemon not found");
  return row;
}

/** Locks every row the trainer owns so party and PC moves see a consistent picture. */
export async function lockAll(tx: DbOrTx, trainerId: string): Promise<PokemonRow[]> {
  return tx
    .select()
    .from(schema.pokemon)
    .where(and(eq(schema.pokemon.trainerId, trainerId), sql`${schema.pokemon.status} <> 'released'`))
    .orderBy(schema.pokemon.slot, schema.pokemon.box, schema.pokemon.boxSlot, schema.pokemon.createdAt)
    .for("update");
}

export function assertTouchable(row: PokemonRow): void {
  if (row.status === "in_transit") throw new ServiceError("in_transit", "this pokemon is out for trade; import the file to bring it home");
  if (row.status === "released") throw new ServiceError("released", "this pokemon was released");
}

export async function listOwned(db: DbOrTx, trainerId: string): Promise<PokemonRow[]> {
  return db.query.pokemon.findMany({
    where: and(eq(schema.pokemon.trainerId, trainerId), sql`${schema.pokemon.status} <> 'released'`),
    orderBy: (p, { asc }) => [asc(p.slot), asc(p.box), asc(p.boxSlot), asc(p.createdAt)],
  });
}

export function partyOf(rows: readonly PokemonRow[]): PokemonRow[] {
  return rows.filter((r) => r.status === "home" && r.slot !== null).sort((a, b) => a.slot! - b.slot!);
}

export function freeSlot(rows: readonly PokemonRow[]): number | null {
  const taken = new Set(partyOf(rows).map((r) => r.slot));
  for (let s = 1; s <= PARTY_SIZE; s++) if (!taken.has(s)) return s;
  return null;
}

export function freeBoxSlot(rows: readonly PokemonRow[], box?: number): { box: number; boxSlot: number } {
  const taken = new Set(rows.filter((r) => r.status === "pc" && r.box !== null).map((r) => `${r.box}:${r.boxSlot}`));
  const boxes = box !== undefined ? [box] : Array.from({ length: 1000 }, (_, i) => i + 1);
  for (const b of boxes) {
    for (let s = 1; s <= BOX_SIZE; s++) if (!taken.has(`${b}:${s}`)) return { box: b, boxSlot: s };
  }
  throw new ServiceError("box_full", `box ${box} is full`);
}

/** Engine events on a log row. Importance follows how much the brain should remember. */
export function episodicFromEngine(row: Pick<PokemonRow, "id" | "identity" | "pokedex">, e: EngineEvent, trainerId: string | null, trainerName: string | null): NewEventRow | null {
  const name = displayName(row);
  const who = trainerName ?? "my trainer";
  let kind: EventKind;
  let summary: string;
  let importance: EpisodicEvent["importance"];
  let emotion: string | undefined;
  switch (e.kind) {
    case "fell_asleep":
      kind = "other";
      summary = e.detail === "put_to_bed" ? `${who} tucked ${name} into bed` : e.detail === "exhausted" ? `${name} fell asleep where it stood` : `${name} fell asleep`;
      importance = 1;
      emotion = e.detail === "exhausted" ? "worn out" : "cozy";
      break;
    case "woke_up":
      kind = "other";
      summary = e.detail === "play" ? `${who} woke ${name} up to play` : e.detail === "trainer" ? `${who} woke ${name} up` : `${name} woke up on its own`;
      importance = 1;
      break;
    case "need_low":
      kind = "neglect";
      summary = `${name} got very ${e.need === "hunger" ? "hungry" : "dirty"}`;
      importance = 2;
      emotion = "unhappy";
      break;
    case "foraged":
      kind = "other";
      summary = `${name} found some ${WILD_FOOD[e.detail ?? ""] ?? "wild berries"} to eat`;
      importance = 1;
      emotion = "content";
      break;
    case "mess":
      kind = "other";
      summary = `${name} made a mess`;
      importance = 1;
      break;
    case "sickness_started":
      kind = "sickness";
      summary = `${name} came down with ${(e.detail ?? "something").replace(/_/g, " ")}`;
      importance = 3;
      emotion = "miserable";
      break;
    case "sickness_worsened":
      kind = "sickness";
      summary = `${name} got sicker (severity ${e.detail ?? "?"})`;
      importance = 3;
      emotion = "miserable";
      break;
    case "sickness_cleared":
      kind = "sickness";
      summary = e.detail === "rest" ? `${name} slept the sickness off` : `${who} gave ${name} ${(e.detail ?? "medicine").replace(/_/g, " ")} and it recovered`;
      importance = 2;
      emotion = "relieved";
      break;
    case "care":
      kind = "care";
      summary = careSummary(e.detail, who, name);
      importance = 1;
      emotion = "content";
      break;
    case "care_mistake":
      kind = "care";
      summary = mistakeSummary(e.detail, who, name);
      importance = 2;
      emotion = "upset";
      break;
    case "refused":
      kind = "care";
      summary = `${name} refused (${(e.detail ?? "").replace(/_/g, " ")})`;
      importance = 1;
      break;
    case "milestone":
      kind = "milestone";
      summary =
        e.detail === "recovery"
          ? `${name}'s ${e.need ?? "need"} is back to full after being very low`
          : e.detail?.startsWith("evolution:")
            ? `${name} evolved from ${titleCase(e.detail.split(":")[1] ?? "")} into ${titleCase(e.detail.split(":")[2] ?? "")}`
            : `${name} reached a milestone: ${e.detail ?? ""}`;
      importance = 3;
      emotion = "proud";
      break;
    case "level_up":
      kind = "milestone";
      summary = `${name} reached level ${e.detail ?? "?"}`;
      importance = 3;
      emotion = "proud";
      break;
    default:
      return null;
  }
  return { pokemonId: row.id, ts: e.at, kind, summary, importance, trainerId, emotion: emotion ?? null };
}

/** What there is to find in each diorama; poor fare, by design. */
const WILD_FOOD: Record<string, string> = {
  meadow: "wild berries",
  forest: "fallen apples",
  beach: "washed-up seaweed",
  cave: "cave mushrooms",
  snowfield: "frozen berries",
  pond: "pond weed",
};

function careSummary(action: string | undefined, who: string, name: string): string {
  switch (action) {
    case "feed":
      return `${who} fed ${name}`;
    case "play":
      return `${who} played with ${name}`;
    case "groom":
      return `${who} groomed ${name}`;
    case "rest":
      return `${who} put ${name} to bed`;
    case "wake":
      return `${who} woke ${name}`;
    case "medicine":
      return `${who} gave ${name} medicine`;
    case "discipline":
      return `${who} scolded ${name}`;
    case "pet":
      return `${who} petted ${name}`;
    default:
      return `${who} looked after ${name}`;
  }
}

function mistakeSummary(detail: string | undefined, who: string, name: string): string {
  switch (detail) {
    case "overfed":
      return `${who} overfed ${name} and it made a mess`;
    case "woken_to_play":
      return `${who} woke ${name} up just to play`;
    case "woken_early":
      return `${who} woke ${name} before it was rested`;
    case "medicine_when_healthy":
      return `${who} gave ${name} medicine it did not need`;
    case "unjust_discipline":
      return `${who} scolded ${name} for nothing`;
    default:
      return `${who} made a care mistake with ${name}`;
  }
}

/** Writes engine events to the log. Returns how many were written. */
export async function logEngineEvents(tx: DbOrTx, row: Pick<PokemonRow, "id" | "identity" | "pokedex">, events: readonly EngineEvent[], trainerId: string | null, trainerName: string | null): Promise<number> {
  const rows = events.map((e) => episodicFromEngine(row, e, trainerId, trainerName)).filter((r): r is NewEventRow => r !== null);
  if (rows.length > 0) await tx.insert(schema.event).values(rows);
  return rows.length;
}

function titleCase(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
