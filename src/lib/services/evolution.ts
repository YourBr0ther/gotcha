/**
 * Evolution: the engine says which rules hold, the trainer says yes or no.
 * Yes swaps the species on the row, keeps level, friendship and memories,
 * takes the stone out of the bag, pays the milestone and writes the memory.
 * No is for now, asked again after the snooze, or never.
 */

import { eq, sql } from "drizzle-orm";
import { declineEvolution, evolutionOptions, evolvedStats, milestoneBonus, type EngineEvent } from "@/lib/sim";
import { schema, type Db } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { publish } from "./bus";
import { ServiceError } from "./errors";
import { assertTouchable, lockPokemon, logEngineEvents } from "./pokemon";
import { getSpecies, normalizeSpecies, pokedexSnapshot, speciesFacts } from "./species";
import { adjustBytes } from "./trainers";
import { displayName, pokemonView, type PokemonView } from "./views";

export interface EvolveOutcome {
  view: PokemonView;
  from: string;
  to: string;
  bytes: number;
  balance: number;
}

export async function evolve(db: Db, trainer: TrainerRow, pokemonId: string, into: string, now = new Date().toISOString()): Promise<EvolveOutcome> {
  const to = normalizeSpecies(into);
  const outcome = await db.transaction(async (tx) => {
    const row = await lockPokemon(tx, trainer.id, pokemonId);
    assertTouchable(row);
    if (row.status !== "home") throw new ServiceError("not_home", "a pokemon in the PC cannot evolve; withdraw it first");
    const record = await getSpecies(row.identity.species);
    const bagRows = await tx.select({ itemId: schema.bag.itemId, qty: schema.bag.qty }).from(schema.bag).where(eq(schema.bag.trainerId, trainer.id)).for("update");
    const bag = bagRows.filter((b) => b.qty > 0).map((b) => b.itemId);
    // The locked bag rows are the only inventory that counts here: a held item
    // would satisfy the rule without anything to take from the bag.
    const rule = evolutionOptions(row.stats, speciesFacts(record), { heldItem: null, bag }, now).find((r) => r.to === to);
    if (!rule) throw new ServiceError("cannot_evolve", `${displayName(row)} cannot evolve into ${to} right now`);
    const target = await getSpecies(to);
    if (rule.trigger === "item" && rule.item) {
      // A stone is used up; the link cable for a trade evolution is a tool and stays.
      const taken = await tx
        .update(schema.bag)
        .set({ qty: sql`${schema.bag.qty} - 1` })
        .where(sql`${schema.bag.trainerId} = ${trainer.id} and ${schema.bag.itemId} = ${rule.item} and ${schema.bag.qty} > 0`)
        .returning({ itemId: schema.bag.itemId });
      if (taken.length !== 1) throw new ServiceError("item_not_in_bag", `no ${rule.item} in the bag`);
    }
    const from = row.identity.species;
    const identity = { ...row.identity, species: target.species, nationalDex: target.nationalDex };
    const stats = evolvedStats(row.stats);
    const pokedex = pokedexSnapshot(target, now);
    const history = { ...row.history, milestones: [...row.history.milestones, { at: now, kind: "evolution", detail: `${from} -> ${target.species}` }] };
    // The milestone pays once per pokemon and target, so a file that leaves
    // and comes back cannot be evolved for Bytes again.
    const ref = `${row.id}:evolution:${target.species}`;
    const paid = await tx
      .select({ id: schema.ledger.id })
      .from(schema.ledger)
      .where(sql`${schema.ledger.trainerId} = ${trainer.id} and ${schema.ledger.reason} = 'milestone' and ${schema.ledger.ref} = ${ref}`)
      .limit(1);
    const bytes = paid.length ? 0 : milestoneBonus("evolution");
    const balance = await adjustBytes(tx, trainer.id, bytes, "milestone", ref);
    await tx.update(schema.pokemon).set({ identity, stats, pokedex, history, updatedAt: now }).where(eq(schema.pokemon.id, row.id));
    const updated: PokemonRow = { ...row, identity, stats, pokedex, history };
    const events: EngineEvent[] = [{ kind: "milestone", at: now, detail: `evolution:${from}:${target.species}` }];
    await logEngineEvents(tx, updated, events, trainer.id, trainer.displayName);
    return { view: await pokemonView(updated, trainer, now), from, to: target.species, bytes, balance, events };
  });
  publish(pokemonId, { type: "state", view: outcome.view, events: outcome.events, cause: "evolve" });
  return { view: outcome.view, from: outcome.from, to: outcome.to, bytes: outcome.bytes, balance: outcome.balance };
}

/** "Not now" or "never" on the evolution ask. */
export async function decline(db: Db, trainer: TrainerRow, pokemonId: string, forever: boolean, now = new Date().toISOString()): Promise<PokemonView> {
  const view = await db.transaction(async (tx) => {
    const row = await lockPokemon(tx, trainer.id, pokemonId);
    assertTouchable(row);
    const stats = declineEvolution(row.stats, forever, now);
    await tx.update(schema.pokemon).set({ stats, updatedAt: now }).where(eq(schema.pokemon.id, row.id));
    return pokemonView({ ...row, stats }, trainer, now);
  });
  publish(pokemonId, { type: "state", view, events: [], cause: "evolve:decline" });
  return view;
}
