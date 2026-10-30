/**
 * Care: decay to now, apply the action, persist state, modifiers, events,
 * experience, friendship and Bytes in one transaction. `settle` is the same
 * without an action, for the scheduler and the roll-up.
 */

import { eq, sql } from "drizzle-orm";
import {
  addExperience,
  adjustFriendship,
  careAction,
  CARE_ACTIONS,
  decay,
  storeItem,
  type CareAction,
  type CareResult,
  type EngineEvent,
  type StoreItem,
} from "@/lib/sim";
import { schema, type Db, type DbOrTx } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { publish } from "./bus";
import { ServiceError } from "./errors";
import { assertTouchable, lockPokemon, logEngineEvents } from "./pokemon";
import { getSpecies, speciesFacts } from "./species";
import { adjustBytes } from "./trainers";
import { liveModifiers, pokemonView, type PokemonView } from "./views";

export interface CareInput {
  action: CareAction;
  /** Store item id from the bag. Required for feed; optional for play and medicine. */
  item?: string;
}

export interface CareOutcome {
  view: PokemonView;
  refused: boolean;
  mistake: boolean;
  experience: number;
  friendship: number;
  bytes: number;
  levelsGained: number[];
  events: EngineEvent[];
  balance: number;
}

export function isCareAction(value: string): value is CareAction {
  return (CARE_ACTIONS as readonly string[]).includes(value);
}

/** Moves a locked row forward to now in memory. The caller persists. */
async function decayRow(row: PokemonRow, now: string) {
  const record = await getSpecies(row.identity.species);
  const modifiers = liveModifiers(row.modifiers, now);
  const { state, events } = decay(row.state, row.personality, speciesFacts(record), now, modifiers);
  return { state, events, modifiers };
}

export async function care(db: Db, trainer: TrainerRow, pokemonId: string, input: CareInput, now = new Date().toISOString()): Promise<CareOutcome> {
  if (!isCareAction(input.action)) throw new ServiceError("unknown_action", `unknown care action "${input.action}"`);

  const outcome = await db.transaction(async (tx) => {
    const row = await lockPokemon(tx, trainer.id, pokemonId);
    assertTouchable(row);
    if (row.status !== "home") throw new ServiceError("not_home", "a pokemon in the PC cannot be cared for; withdraw it first");

    let item: StoreItem | null = null;
    if (input.item) {
      item = storeItem(input.item) ?? null;
      if (!item) throw new ServiceError("unknown_item", `unknown item "${input.item}"`);
      const [bagRow] = await tx
        .select({ qty: schema.bag.qty })
        .from(schema.bag)
        .where(sql`${schema.bag.trainerId} = ${trainer.id} and ${schema.bag.itemId} = ${item.id}`)
        .for("update");
      if (!bagRow || bagRow.qty < 1) throw new ServiceError("item_not_in_bag", `no ${item.name} in the bag`);
    }
    if (input.action === "feed" && !item?.effects.fill?.hunger) throw new ServiceError("item_required", "feed needs a food item from the bag");

    const decayed = await decayRow(row, now);
    const result: CareResult = careAction(decayed.state, input.action, item, now);
    const events = [...decayed.events, ...result.events];

    let stats = row.stats;
    let levelsGained: number[] = [];
    let balance = trainer.bytes;
    const modifiers = [...decayed.modifiers];
    if (!result.refused) {
      const exp = addExperience(stats, result.experience, now);
      stats = adjustFriendship(exp.stats, result.friendship);
      levelsGained = exp.levelsGained;
      events.push(...exp.events);
      if (result.modifier) modifiers.push(result.modifier);
      if (item) {
        await tx
          .update(schema.bag)
          .set({ qty: sql`${schema.bag.qty} - 1` })
          .where(sql`${schema.bag.trainerId} = ${trainer.id} and ${schema.bag.itemId} = ${item.id}`);
      }
      if (result.bytes > 0) balance = await adjustBytes(tx, trainer.id, result.bytes, "milestone", `${row.id}:${now}`);
    }

    await tx
      .update(schema.pokemon)
      .set({ state: result.state, stats, modifiers, updatedAt: now })
      .where(eq(schema.pokemon.id, row.id));
    await logEngineEvents(tx, row, events, trainer.id, trainer.displayName);

    const updated: PokemonRow = { ...row, state: result.state, stats, modifiers };
    const view = await pokemonView(updated, trainer, now);
    return {
      view,
      refused: result.refused,
      mistake: result.mistake,
      experience: result.refused ? 0 : result.experience,
      friendship: result.refused ? 0 : result.friendship,
      bytes: result.refused ? 0 : result.bytes,
      levelsGained,
      events,
      balance,
    } satisfies CareOutcome;
  });

  publish(pokemonId, { type: "state", view: outcome.view, events: outcome.events, cause: `care:${input.action}` });
  return outcome;
}

/**
 * Persists decay to now with no action. Used by the scheduler before a
 * brain tick and by the nightly roll-up so engine events reach the log.
 */
export async function settle(db: DbOrTx, trainer: TrainerRow, pokemonId: string, now = new Date().toISOString()): Promise<PokemonView> {
  const run = async (tx: DbOrTx) => {
    const row = await lockPokemon(tx, trainer.id, pokemonId);
    if (row.status !== "home") return pokemonView(row, trainer, now);
    const decayed = await decayRow(row, now);
    await tx.update(schema.pokemon).set({ state: decayed.state, modifiers: decayed.modifiers, updatedAt: now }).where(eq(schema.pokemon.id, row.id));
    await logEngineEvents(tx, row, decayed.events, null, null);
    return pokemonView({ ...row, state: decayed.state, modifiers: decayed.modifiers }, trainer, now);
  };
  // A transaction handle nests as a savepoint, so either kind of db works here.
  const view = await (db as Db).transaction(run);
  publish(pokemonId, { type: "state", view, cause: "settle" });
  return view;
}
