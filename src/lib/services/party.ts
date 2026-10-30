/**
 * The party: up to six slots, exactly one active pokemon whenever the party
 * is non-empty. An in_transit pokemon holds no slot and cannot be active.
 */

import { eq, inArray } from "drizzle-orm";
import { schema, type Db, type DbOrTx } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { assertTouchable, listOwned, lockAll, partyOf, PARTY_SIZE } from "./pokemon";
import { pokemonView, type PokemonView } from "./views";

export interface PartyView {
  size: number;
  party: PokemonView[];
  activeId: string | null;
}

export async function getParty(db: DbOrTx, trainer: TrainerRow, now: string): Promise<PartyView> {
  const rows = partyOf(await listOwned(db, trainer.id));
  const party = await Promise.all(rows.map((r) => pokemonView(r, trainer, now)));
  return { size: PARTY_SIZE, party, activeId: rows.find((r) => r.active)?.id ?? null };
}

/**
 * Keeps the active invariant after any move: when the party has members and
 * none is active, the lowest slot becomes active; a non-party row is never
 * active. Call with locked rows reflecting the new slots.
 */
export async function reconcileActive(tx: DbOrTx, rows: readonly PokemonRow[]): Promise<void> {
  const party = partyOf(rows);
  const strays = rows.filter((r) => r.active && !party.includes(r));
  if (strays.length > 0) {
    await tx.update(schema.pokemon).set({ active: false }).where(inArray(schema.pokemon.id, strays.map((r) => r.id)));
    for (const s of strays) s.active = false;
  }
  if (party.length > 0 && !party.some((r) => r.active)) {
    await tx.update(schema.pokemon).set({ active: true }).where(eq(schema.pokemon.id, party[0].id));
    party[0].active = true;
  }
}

export interface PartyUpdate {
  /** Pokemon ids in slot order. Must be exactly the current party. */
  order?: string[];
  /** The pokemon to make active. Must be in the party. */
  activeId?: string;
}

export async function updateParty(db: Db, trainer: TrainerRow, update: PartyUpdate): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await lockAll(tx, trainer.id);
    const party = partyOf(rows);

    if (update.order) {
      const ids = new Set(party.map((r) => r.id));
      const wanted = update.order;
      if (wanted.length !== ids.size || new Set(wanted).size !== wanted.length || !wanted.every((id) => ids.has(id))) {
        throw new ServiceError("bad_request", "order must list every party pokemon exactly once");
      }
      // Two passes so the unique (trainer, slot) index never collides mid-shuffle.
      await tx.update(schema.pokemon).set({ slot: null }).where(inArray(schema.pokemon.id, wanted));
      for (let i = 0; i < wanted.length; i++) {
        await tx.update(schema.pokemon).set({ slot: i + 1, updatedAt: new Date().toISOString() }).where(eq(schema.pokemon.id, wanted[i]));
        const row = rows.find((r) => r.id === wanted[i])!;
        row.slot = i + 1;
      }
    }

    if (update.activeId !== undefined) {
      const target = rows.find((r) => r.id === update.activeId);
      if (!target) throw new ServiceError("not_found", "pokemon not found");
      assertTouchable(target);
      if (target.status !== "home" || target.slot === null) throw new ServiceError("not_in_party", "only a party pokemon can be active");
      const current = rows.find((r) => r.active);
      if (current && current.id !== target.id) {
        await tx.update(schema.pokemon).set({ active: false }).where(eq(schema.pokemon.id, current.id));
        current.active = false;
      }
      if (!target.active) {
        await tx.update(schema.pokemon).set({ active: true, updatedAt: new Date().toISOString() }).where(eq(schema.pokemon.id, target.id));
        target.active = true;
      }
    }

    await reconcileActive(tx, rows);
  });
}
