import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { EpisodicEvent } from "@gotcha/cpkmn";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { EPISODIC_LIMIT, getJournal } from "./journal";
import { insertPokemon, later, makeTrainer, T0 } from "./testing";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("journal");
  await t.truncate();
});
afterAll(() => t?.cleanup());

function episodic(ts: string, summary: string): EpisodicEvent {
  return { ts, kind: "care", summary, importance: 1 };
}

describe("journal", () => {
  it("is empty for a pokemon with no memories and no roll-ups", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer);
    const journal = await getJournal(t.db, trainer.id, row.id);
    expect(journal).toEqual({ pokemonId: row.id, summary: "", relationships: {}, episodic: [], journalEntries: [], newestAt: null });
  });

  it("returns memories newest first, the Journal rows, and the newest timestamp across both", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer);
    const memories = {
      summary: "A quiet first week.",
      episodic: [episodic(T0, "Eli fed Vee"), episodic(later(T0, 60_000), "Eli played with Vee")],
      relationships: { [trainer.id]: { bond: 12, callsThem: "Eli" } },
    };
    await t.db.update(schema.pokemon).set({ memories }).where(eq(schema.pokemon.id, row.id));
    const journalTs = later(T0, 3_600_000);
    await t.db.insert(schema.event).values([
      { pokemonId: row.id, ts: later(T0, 120_000), kind: "care", summary: "Eli groomed Vee", importance: 1, rolledUp: false },
      { pokemonId: row.id, ts: journalTs, kind: "other", summary: "Journal, 2026-11-02: Eli came by twice.", importance: 2, emotion: "reflective", rolledUp: true },
      { pokemonId: row.id, ts: T0, kind: "other", summary: "Journal, 2026-11-01: Hatched.", importance: 2, rolledUp: true },
    ]);

    const journal = await getJournal(t.db, trainer.id, row.id);
    expect(journal.summary).toBe("A quiet first week.");
    expect(journal.relationships).toEqual(memories.relationships);
    expect(journal.episodic.map((e) => e.summary)).toEqual(["Eli played with Vee", "Eli fed Vee"]);
    // Only the dated roll-up rows, newest first; the unrolled care row stays out.
    expect(journal.journalEntries.map((e) => e.summary)).toEqual(["Journal, 2026-11-02: Eli came by twice.", "Journal, 2026-11-01: Hatched."]);
    expect(journal.journalEntries[0]).toMatchObject({ ts: journalTs, emotion: "reflective" });
    expect(journal.newestAt).toBe(journalTs);
  });

  it("caps episodic memories at the limit, keeping the newest", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer);
    const episodicList = Array.from({ length: EPISODIC_LIMIT + 5 }, (_, i) => episodic(later(T0, i * 1000), `event ${i}`));
    await t.db.update(schema.pokemon).set({ memories: { summary: "", episodic: episodicList, relationships: {} } }).where(eq(schema.pokemon.id, row.id));
    const journal = await getJournal(t.db, trainer.id, row.id);
    expect(journal.episodic).toHaveLength(EPISODIC_LIMIT);
    expect(journal.episodic[0].summary).toBe(`event ${EPISODIC_LIMIT + 4}`);
    expect(journal.newestAt).toBe(later(T0, (EPISODIC_LIMIT + 4) * 1000));
  });

  it("is not readable by another trainer", async () => {
    const owner = await makeTrainer(t.db, "eli");
    const other = await makeTrainer(t.db, "maya");
    const row = await insertPokemon(t.db, owner);
    await expect(getJournal(t.db, other.id, row.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
