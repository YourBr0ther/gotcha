import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { EpisodicEvent } from "@gotcha/cpkmn";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { getJournal, isChatter, JOURNAL_DAYS, parsePage, worthALine } from "./journal";
import { insertPokemon, later, makeTrainer, T0 } from "./testing";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("journal");
  await t.truncate();
});
afterAll(() => t?.cleanup());

const DAY = 86_400_000;

function episodic(ts: string, summary: string, extra: Partial<EpisodicEvent> = {}): EpisodicEvent {
  return { ts, kind: "care", summary, importance: 1, ...extra };
}

describe("journal", () => {
  it("is empty for a pokemon with no memories and no roll-ups", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer);
    const journal = await getJournal(t.db, trainer.id, row.id, T0);
    expect(journal).toEqual({ pokemonId: row.id, summary: "", relationships: {}, today: "2026-11-02", days: [], newestAt: null });
  });

  it("groups pages and moments by the trainer's local day, newest first, with today live from the log", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    await t.db.update(schema.trainer).set({ timezone: "America/New_York" }).where(eq(schema.trainer.id, eli.id));
    const trainer = (await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, eli.id) }))!;
    const row = await insertPokemon(t.db, trainer);
    const memories = {
      summary: "Eli is my trainer. We have had two days together.",
      episodic: [
        episodic(later(T0, -DAY), "Eli fed Vee"),
        episodic(later(T0, -DAY + 60_000), "Eli fed Vee"),
        episodic(later(T0, -DAY + 120_000), 'Vee said "vee vee"', { kind: "talk", trainerId: eli.id }),
        episodic(later(T0, -DAY + 180_000), "Vee fell asleep", { kind: "other" }),
        episodic(later(T0, -DAY + 240_000), "Vee reached level 2", { kind: "milestone", importance: 3, emotion: "proud" }),
        episodic(later(T0, -DAY + 300_000), "Journal, 2026-11-01: Eli fed me twice.", { kind: "other", importance: 2 }),
      ],
      relationships: { [trainer.id]: { bond: 12, callsThem: "Eli" } },
    };
    await t.db.update(schema.pokemon).set({ memories }).where(eq(schema.pokemon.id, row.id));
    const pageTs = later(T0, -DAY + 300_000);
    await t.db.insert(schema.event).values([
      { pokemonId: row.id, ts: pageTs, kind: "other", summary: "Journal, 2026-11-01: Eli fed me twice. I made it to level 2!", importance: 2, emotion: "proud", rolledUp: true },
      // Today, not rolled up yet: a real moment, a conversation, and chatter.
      { pokemonId: row.id, ts: T0, kind: "care", summary: "Eli groomed Vee", importance: 1, trainerId: trainer.id, rolledUp: false },
      { pokemonId: row.id, ts: later(T0, 60_000), kind: "talk", summary: 'Eli said "hi"; Vee answered "vee!"', importance: 1, trainerId: trainer.id, rolledUp: false },
      { pokemonId: row.id, ts: later(T0, 120_000), kind: "talk", summary: 'Vee said "vee..."', importance: 1, trainerId: trainer.id, rolledUp: false },
    ]);

    const journal = await getJournal(t.db, trainer.id, row.id, T0);
    expect(journal.today).toBe("2026-11-02");
    expect(journal.summary).toBe(memories.summary);
    expect(journal.days.map((d) => d.day)).toEqual(["2026-11-02", "2026-11-01"]);

    const [today, yesterday] = journal.days;
    expect(today.page).toBeNull();
    expect(today.moments.map((m) => m.summary)).toEqual(["Eli groomed Vee", 'Eli said "hi"; Vee answered "vee!"']);

    expect(yesterday).toMatchObject({ page: "Eli fed me twice. I made it to level 2!", pageAt: pageTs, feeling: "proud" });
    // Two feeds collapse to one line; the idle line, the nap and the page itself stay out.
    expect(yesterday.moments.map((m) => [m.summary, m.times])).toEqual([
      ["Eli fed Vee", 2],
      ["Vee reached level 2", 1],
    ]);
    expect(journal.newestAt).toBe(pageTs);
  });

  it("keeps the newest days when there are more than the limit", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer);
    const episodicList = Array.from({ length: JOURNAL_DAYS + 5 }, (_, i) => episodic(later(T0, -i * DAY), `event ${i}`));
    await t.db.update(schema.pokemon).set({ memories: { summary: "", episodic: episodicList, relationships: {} } }).where(eq(schema.pokemon.id, row.id));
    const journal = await getJournal(t.db, trainer.id, row.id, T0);
    expect(journal.days).toHaveLength(JOURNAL_DAYS);
    expect(journal.days[0].moments[0].summary).toBe("event 0");
    expect(journal.newestAt).toBeNull();
  });

  it("is not readable by another trainer", async () => {
    const owner = await makeTrainer(t.db, "eli");
    const other = await makeTrainer(t.db, "maya");
    const row = await insertPokemon(t.db, owner);
    await expect(getJournal(t.db, other.id, row.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("what earns a line", () => {
  it("tells idle chatter from a conversation", () => {
    expect(isChatter('Maddie said "Mmmnn... tummy hurts..."')).toBe(true);
    expect(isChatter('Chris said "hello"; Maddie answered "char!"')).toBe(false);
    expect(isChatter("Chris fed Maddie")).toBe(false);
  });

  it("keeps what mattered and what the trainer did, drops the body clock and the pages", () => {
    expect(worthALine({ kind: "care", importance: 1, summary: "Chris fed Maddie" })).toBe(true);
    expect(worthALine({ kind: "play", importance: 1, summary: "Chris played a good round of Type Match with Maddie" })).toBe(true);
    expect(worthALine({ kind: "sickness", importance: 3, summary: "Maddie came down with stomach ache" })).toBe(true);
    expect(worthALine({ kind: "other", importance: 1, summary: "Maddie woke up on its own" })).toBe(false);
    expect(worthALine({ kind: "other", importance: 1, summary: "Maddie made a mess" })).toBe(false);
    expect(worthALine({ kind: "talk", importance: 1, summary: 'Maddie said "char..."' })).toBe(false);
    expect(worthALine({ kind: "other", importance: 2, summary: "Journal, 2026-11-01: A quiet day." })).toBe(false);
  });

  it("parses a page row", () => {
    expect(parsePage("Journal, 2026-11-01: Eli fed me twice.")).toEqual({ day: "2026-11-01", text: "Eli fed me twice." });
    expect(parsePage("Eli fed Vee")).toBeNull();
  });
});
