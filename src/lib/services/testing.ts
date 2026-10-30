/**
 * Fixtures for the service tests: trainers and pokemon rows in a test
 * schema. Pokemon come from buildStarter so they are schema-valid files.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { PokemonRow, PokemonStatus, TrainerRow } from "@/lib/db/schema";
import { getSpecies } from "./species";
import { buildStarter, type StarterInput } from "./starter";
import { upsertTrainer } from "./trainers";

export const T0 = "2026-11-02T20:00:00.000Z";

export function later(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export async function makeTrainer(db: Db, username: string, displayName = username): Promise<TrainerRow> {
  return upsertTrainer(db, username, displayName);
}

export interface InsertOptions extends Partial<StarterInput> {
  status?: PokemonStatus;
  slot?: number | null;
  active?: boolean;
  box?: number | null;
  boxSlot?: number | null;
  now?: string;
}

/** A deterministic random so natures and genders do not change between runs. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

let counter = 0;

export async function insertPokemon(db: Db, trainer: TrainerRow, options: InsertOptions = {}): Promise<PokemonRow> {
  const now = options.now ?? T0;
  const record = await getSpecies(options.species ?? "eevee");
  const pokemon = buildStarter(record, trainer, { species: record.species, nickname: options.nickname, gender: options.gender }, now, seeded(++counter));
  const status = options.status ?? "home";
  const [row] = await db
    .insert(schema.pokemon)
    .values({
      id: pokemon.identity.pokemonId,
      trainerId: trainer.id,
      identity: pokemon.identity,
      stats: pokemon.stats,
      state: pokemon.state,
      personality: pokemon.personality,
      memories: pokemon.memories,
      pokedex: pokemon.pokedex,
      inventory: pokemon.inventory,
      history: pokemon.history,
      status,
      slot: options.slot === undefined ? (status === "home" ? 1 : null) : options.slot,
      active: options.active ?? false,
      box: options.box ?? null,
      boxSlot: options.boxSlot ?? null,
      modifiers: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function giveBytes(db: Db, trainer: TrainerRow, bytes: number): Promise<TrainerRow> {
  const [row] = await db.update(schema.trainer).set({ bytes }).where(eq(schema.trainer.id, trainer.id)).returning();
  return row;
}
