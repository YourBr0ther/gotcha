import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { SUMMARY_MAX_CHARS, validateMember } from "@gotcha/cpkmn";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { rebuildMemories, rollover } from "@/lib/services/rollover";
import { insertPokemon, later, makeTrainer, T0 } from "@/lib/services/testing";
import { BOND_DAILY_SWING, PAGE_MAX_CHARS, RELATIONSHIP_NOTES_MAX } from "./constants";
import { NEW_BOND } from "./converse";
import { clipSummary, dayOfEvents, rollupDay, rulesBondDelta, rulesPage, rulesSummary, updateRelationship } from "./rollup";
import { answering, fakeContext } from "./test/helpers";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("brain_rollup");
  await t.truncate();
});
afterAll(() => t?.cleanup());

const NIGHT = later(T0, 4 * 3600_000); // 2026-11-03T00:00Z, still 2026-11-02 in New York

async function dayOf(trainerId: string, pokemonId: string, count: number) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      pokemonId,
      ts: later(T0, i * 60_000),
      kind: i % 7 === 3 ? "neglect" : i % 2 === 0 ? "care" : "play",
      summary: `Eli ${i % 2 === 0 ? "fed" : "played with"} Vee, round ${i}, and it was a longer story than it needed to be`,
      importance: i % 5 === 0 ? 3 : 1,
      trainerId: i % 7 === 3 ? null : trainerId,
      emotion: i % 2 === 0 ? "content" : "happy",
    });
  }
  await t.db.insert(schema.event).values(rows);
  return t.db.query.event.findMany({ where: eq(schema.event.pokemonId, pokemonId), orderBy: (e, { asc }) => [asc(e.ts), asc(e.id)] });
}

describe("rollupDay", () => {
  it("without a model, writes a page and a summary under the limits, promotes the day's events, moves the bond and dates the page by the events", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    await t.db.update(schema.trainer).set({ timezone: "America/New_York" }).where(eq(schema.trainer.id, eli.id));
    const trainer = (await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, eli.id) }))!;
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
    const events = await dayOf(trainer.id, row.id, 60);

    const result = await rollupDay({ db: t.db, trainer, row, events, now: NIGHT });
    expect(result.source).toBe("rules");
    expect(result.day).toBe("2026-11-02");
    expect(result.summary.length).toBeLessThan(SUMMARY_MAX_CHARS);
    expect(result.summary).toContain("2026-11-02:");
    expect(result.summary).toContain("round 0");
    // The page is the day's biggest moments, oldest first, not the whole summary.
    expect(result.page.length).toBeLessThanOrEqual(PAGE_MAX_CHARS);
    expect(result.page).toContain("round 0");
    expect(result.page).not.toContain("2026-11-02");

    const saved = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(saved.memories.summary).toBe(result.summary);
    expect(saved.memories.episodic.length).toBe(events.length + 1);
    expect(saved.memories.episodic.at(-1)).toMatchObject({ kind: "other", summary: `Journal, 2026-11-02: ${result.page}` });
    const rel = saved.memories.relationships[trainer.id];
    expect(rel.bond).toBe(NEW_BOND + BOND_DAILY_SWING);
    expect(rel.callsThem).toBe("Eli");
    expect(rel.notes).toHaveLength(1);
    expect(rel.notes![0]).toContain("2026-11-02:");
    for (const e of saved.memories.episodic) expect(validateMember("episodicEvent", e)).toEqual([]);
    expect(validateMember("relationships", saved.memories.relationships)).toEqual([]);

    const journal = await t.db.query.event.findFirst({ where: eq(schema.event.id, result.journal.id) });
    expect(journal).toMatchObject({ kind: "other", rolledUp: true, importance: 2, trainerId: null, summary: `Journal, 2026-11-02: ${result.page}` });
  });

  it("dates the page by the day the events happened, not the night the job runs", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    await t.db.update(schema.trainer).set({ timezone: "America/New_York" }).where(eq(schema.trainer.id, eli.id));
    const trainer = (await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, eli.id) }))!;
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const events = await dayOf(trainer.id, row.id, 3);
    // 1am New York on the 3rd: the events are still the 2nd's.
    const result = await rollupDay({ db: t.db, trainer, row, events, now: later(T0, 10 * 3600_000) });
    expect(result.day).toBe("2026-11-02");
    expect(dayOfEvents([], "America/New_York", later(T0, 10 * 3600_000))).toBe("2026-11-03");
  });

  it("folds the previous summary behind today and never passes the limit", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const old = "I remember the first day. ".repeat(200);
    await t.db.update(schema.pokemon).set({ memories: { ...row.memories, summary: old } }).where(eq(schema.pokemon.id, row.id));
    const current = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    const events = await dayOf(eli.id, row.id, 200);
    const result = await rollupDay({ db: t.db, trainer: eli, row: current, events, now: NIGHT });
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(result.summary).toContain("I remember the first day");
  });

  it("takes the model's summary, notes and bond change, clipped to the limit", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const events = await dayOf(eli.id, row.id, 5);
    const generate = answering({ page: "Eli fed me twice and we played. Best day yet! ".repeat(20), summary: "Eli fed me twice today. I like the oran ones best. ".repeat(60), feeling: " Happy ", callsThem: "Big Eli", notes: ["gives the good berries", "sings off key"], bondDelta: 4 }, 500);
    const result = await rollupDay({ db: t.db, trainer: eli, row, events, now: NIGHT }, { generate, model: "fake", budget: { configured: true } });
    expect(result.source).toBe("model");
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(result.page.length).toBeLessThanOrEqual(PAGE_MAX_CHARS);
    expect(result.page.startsWith("Eli fed me twice and we played.")).toBe(true);
    expect(result.journal).toMatchObject({ emotion: "happy", summary: `Journal, 2026-11-02: ${result.page}` });
    expect(result.memories.relationships[eli.id]).toMatchObject({ bond: NEW_BOND + 4, callsThem: "Big Eli", notes: ["gives the good berries", "sings off key"] });
    const usage = await t.db.query.brainUsage.findFirst({ where: eq(schema.brainUsage.pokemonId, row.id) });
    expect(usage).toMatchObject({ talkCalls: 1, tokens: 500 });
  });

  it("a bad answer from the model falls back to the rules summary", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const events = await dayOf(eli.id, row.id, 3);
    const result = await rollupDay({ db: t.db, trainer: eli, row, events, now: NIGHT }, { generate: answering({ summary: "" }), model: "fake", budget: { configured: true } });
    expect(result).toMatchObject({ source: "rules", reason: "rejected" });
    expect(result.summary).toContain("round 0");
  });

  it("runs from the nightly rollover, one page per finished day, and leaves today for tomorrow night", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    await dayOf(eli.id, row.id, 4);
    // A day earlier, and one row after midnight UTC on the 3rd that is still today when the job runs.
    await t.db.insert(schema.event).values([
      { pokemonId: row.id, ts: later(T0, -86_400_000), kind: "care", summary: "Eli fed Vee the day before", importance: 1, trainerId: eli.id },
      { pokemonId: row.id, ts: later(NIGHT, 60_000), kind: "care", summary: "Eli fed Vee after midnight", importance: 1, trainerId: eli.id },
    ]);
    const result = await rollover(t.db, later(NIGHT, 3600_000));
    expect(result.eventsRolledUp).toBe(5);
    const pending = await t.db.query.event.findMany({ where: eq(schema.event.rolledUp, false) });
    expect(pending.map((e) => e.summary)).toEqual(["Eli fed Vee after midnight"]);
    const pages = await t.db.query.event.findMany({ where: like(schema.event.summary, "Journal,%"), orderBy: (e, { asc }) => [asc(e.id)] });
    expect(pages.map((e) => e.summary.slice(0, 20))).toEqual(["Journal, 2026-11-01:", "Journal, 2026-11-02:"]);
    const saved = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(saved.memories.summary).toContain("2026-11-02:");
    expect(saved.memories.summary).toContain("2026-11-01:");
    expect(saved.memories.episodic.length).toBe(7);
  });

  it("rebuilds the pages and the memory from the log", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    await dayOf(eli.id, row.id, 4);
    await rollover(t.db, later(NIGHT, 3600_000));
    const before = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    const rebuilt = await rebuildMemories(t.db, row.id, later(NIGHT, 3600_000));
    expect(rebuilt.pokemon).toEqual([{ id: row.id, eventsRolledUp: 4 }]);
    const pages = await t.db.query.event.findMany({ where: like(schema.event.summary, "Journal,%") });
    expect(pages).toHaveLength(1);
    const after = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(after.memories.summary).toBe(before.memories.summary);
    expect(after.memories.episodic).toHaveLength(before.memories.episodic.length);
  });
});

describe("rules helpers", () => {
  it("clipSummary ends at a sentence when it can", () => {
    const text = "One sentence here. Two sentences here. ".repeat(100);
    const clipped = clipSummary(text, 300);
    expect(clipped.length).toBeLessThanOrEqual(300);
    expect(clipped.endsWith(".…")).toBe(true);
  });

  it("rulesPage is the biggest moments in order, and honest about a quiet day", () => {
    const events = [
      { ts: "2026-11-02T10:00:00.000Z", kind: "care" as const, summary: "Eli fed Vee", importance: 1 as const },
      { ts: "2026-11-02T11:00:00.000Z", kind: "milestone" as const, summary: "Vee reached level 2.", importance: 3 as const },
      { ts: "2026-11-02T12:00:00.000Z", kind: "play" as const, summary: "Eli played a perfect round of Berry Catch with Vee", importance: 2 as const },
      { ts: "2026-11-02T13:00:00.000Z", kind: "other" as const, summary: "Vee fell asleep", importance: 1 as const },
    ];
    expect(rulesPage(events)).toBe("Eli fed Vee. Vee reached level 2. Eli played a perfect round of Berry Catch with Vee.");
    expect(rulesPage([])).toBe("A quiet day. Nothing much happened.");
  });

  it("rulesSummary reads first person in the voice and lists a quiet day honestly", () => {
    const ctx = fakeContext({ summary: "" });
    const summary = rulesSummary({ ...ctx, dayEvents: [], day: "2026-11-02" });
    expect(summary).toContain("(short vee-vee cries)");
    expect(summary).toContain("a quiet day");
  });

  it("the bond moves with care and against neglect, within the daily swing", () => {
    const trainer = "00000000-0000-4000-8000-0000000000aa";
    const care = Array.from({ length: 30 }, (_, i) => ({ ts: `2026-11-02T10:${String(i).padStart(2, "0")}:00.000Z`, kind: "care" as const, summary: "fed", importance: 1 as const, trainerId: trainer }));
    expect(rulesBondDelta(care, trainer)).toBe(BOND_DAILY_SWING);
    const bad = [
      { ts: "2026-11-02T10:00:00.000Z", kind: "neglect" as const, summary: "hungry", importance: 2 as const },
      { ts: "2026-11-02T11:00:00.000Z", kind: "care" as const, summary: "scolded for nothing", importance: 2 as const, trainerId: trainer, emotion: "upset" },
    ];
    expect(rulesBondDelta(bad, trainer)).toBe(-3);
    const rel = updateRelationship({ bond: 2, notes: Array.from({ length: 12 }, (_, i) => `note ${i}`) }, "Eli", "2026-11-02", bad, { bondDelta: -3, notes: [] }, "2026-11-03T00:00:00.000Z");
    expect(rel.bond).toBe(0);
    expect(rel.notes).toHaveLength(RELATIONSHIP_NOTES_MAX);
    expect(rel.notes!.at(-1)).toContain("scolded");
    expect(rel.lastSeenAt).toBe("2026-11-02T11:00:00.000Z");
  });
});
