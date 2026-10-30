/**
 * Drizzle schema. The pokemon row keeps one jsonb column per .cpkmn member
 * so the file and the row share a shape; the engine reads and writes those
 * columns as the cpkmn types without translation.
 *
 * Enumerated columns are text with a CHECK rather than Postgres enum types.
 * drizzle-kit qualifies enum types with "public", which stops the test
 * suite from running each file in its own schema.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  History,
  Identity,
  Inventory,
  Memories,
  Personality,
  Pokedex,
  State,
  Stats,
} from "@gotcha/cpkmn";
import type { ActiveModifier } from "@/lib/sim";

export const POKEMON_STATUSES = ["home", "pc", "in_transit", "released"] as const;
export type PokemonStatus = (typeof POKEMON_STATUSES)[number];

export const TRADE_STATES = ["offered", "cancelled", "confirmed", "expired"] as const;
export type TradeState = (typeof TRADE_STATES)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
};

export const trainer = pgTable("trainer", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Authelia's Remote-User. */
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  bytes: integer("bytes").notNull().default(0),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamps.createdAt,
});

export const pokemon = pgTable(
  "pokemon",
  {
    /** The cpkmn pokemonId. */
    id: uuid("id").primaryKey(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => trainer.id),
    identity: jsonb("identity").$type<Identity>().notNull(),
    stats: jsonb("stats").$type<Stats>().notNull(),
    state: jsonb("state").$type<State>().notNull(),
    personality: jsonb("personality").$type<Personality>().notNull(),
    memories: jsonb("memories").$type<Memories>().notNull(),
    pokedex: jsonb("pokedex").$type<Pokedex>().notNull(),
    inventory: jsonb("inventory").$type<Inventory>().notNull(),
    history: jsonb("history").$type<History>().notNull(),
    /** 1 to 6 while in the party, null otherwise. */
    slot: integer("slot"),
    active: boolean("active").notNull().default(false),
    box: integer("box"),
    boxSlot: integer("box_slot"),
    status: text("status").$type<PokemonStatus>().notNull().default("home"),
    /** Toy buffs and the like; passed back into every decay. */
    modifiers: jsonb("modifiers").$type<ActiveModifier[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pokemon_trainer_slot_idx").on(t.trainerId, t.slot),
    uniqueIndex("pokemon_trainer_box_slot_idx").on(t.trainerId, t.box, t.boxSlot),
    uniqueIndex("pokemon_trainer_active_idx").on(t.trainerId).where(sql`${t.active}`),
    index("pokemon_trainer_status_idx").on(t.trainerId, t.status),
    check("pokemon_status_check", sql`${t.status} in ('home', 'pc', 'in_transit', 'released')`),
    check("pokemon_slot_check", sql`${t.slot} is null or (${t.slot} between 1 and 6)`),
    check("pokemon_box_slot_check", sql`${t.boxSlot} is null or (${t.boxSlot} between 1 and 30)`),
  ],
);

/** Append-only episodic log. Rolled into the pokemon's memories nightly. */
export const event = pgTable(
  "event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    pokemonId: uuid("pokemon_id")
      .notNull()
      .references(() => pokemon.id),
    ts: timestamp("ts", { withTimezone: true, mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    importance: integer("importance").notNull(),
    trainerId: uuid("trainer_id").references(() => trainer.id),
    emotion: text("emotion"),
    rolledUp: boolean("rolled_up").notNull().default(false),
  },
  (t) => [
    index("event_pokemon_ts_idx").on(t.pokemonId, t.ts),
    index("event_pending_idx").on(t.pokemonId).where(sql`not ${t.rolledUp}`),
    check("event_importance_check", sql`${t.importance} between 1 and 5`),
  ],
);

export const bag = pgTable(
  "bag",
  {
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => trainer.id),
    itemId: text("item_id").notNull(),
    qty: integer("qty").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.trainerId, t.itemId] }), check("bag_qty_check", sql`${t.qty} >= 0`)],
);

/** Every Bytes change. The balance on trainer is the running sum. */
export const ledger = pgTable(
  "ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => trainer.id),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref"),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_trainer_at_idx").on(t.trainerId, t.at),
    // One stipend per trainer per local day. ref holds the day.
    uniqueIndex("ledger_stipend_day_idx").on(t.trainerId, t.ref).where(sql`${t.reason} = 'stipend'`),
  ],
);

export const trade = pgTable(
  "trade",
  {
    nonce: text("nonce").primaryKey(),
    pokemonId: uuid("pokemon_id")
      .notNull()
      .references(() => pokemon.id),
    fromTrainerId: uuid("from_trainer_id")
      .notNull()
      .references(() => trainer.id),
    toTrainerId: uuid("to_trainer_id").references(() => trainer.id),
    state: text("state").$type<TradeState>().notNull().default("offered"),
    offeredAt: timestamp("offered_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    index("trade_pokemon_state_idx").on(t.pokemonId, t.state),
    check("trade_state_check", sql`${t.state} in ('offered', 'cancelled', 'confirmed', 'expired')`),
  ],
);

export const brainUsage = pgTable(
  "brain_usage",
  {
    pokemonId: uuid("pokemon_id")
      .notNull()
      .references(() => pokemon.id),
    day: date("day", { mode: "string" }).notNull(),
    tickCalls: integer("tick_calls").notNull().default(0),
    talkCalls: integer("talk_calls").notNull().default(0),
    tokens: integer("tokens").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.pokemonId, t.day] })],
);

export type TrainerRow = typeof trainer.$inferSelect;
export type PokemonRow = typeof pokemon.$inferSelect;
export type NewPokemonRow = typeof pokemon.$inferInsert;
export type EventRow = typeof event.$inferSelect;
export type NewEventRow = typeof event.$inferInsert;
export type BagRow = typeof bag.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
export type TradeRow = typeof trade.$inferSelect;
export type BrainUsageRow = typeof brainUsage.$inferSelect;
