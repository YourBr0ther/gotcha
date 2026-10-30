import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SUMMARY_MAX_CHARS, validateMember } from "@gotcha/cpkmn";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { rollover } from "@/lib/services/rollover";
import { insertPokemon, later, makeTrainer, T0 } from "@/lib/services/testing";
import { BOND_DAILY_SWING, RELATIONSHIP_NOTES_MAX } from "./constants";
import { NEW_BOND } from "./converse";
import { clipSummary, rollupDay, rulesBondDelta, rulesSummary, updateRelationship } from "./rollup";
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
  it("without a model, writes a summary under the limit, promotes the day's events, moves the bond and leaves a journal page", async () => {
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

    const saved = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(saved.memories.summary).toBe(result.summary);
    expect(saved.memories.episodic.length).toBe(events.length + 1);
    expect(saved.memories.episodic.at(-1)).toMatchObject({ kind: "other", emotion: "reflective" });
    expect(saved.memories.episodic.at(-1)!.summary.startsWith("Journal, 2026-11-02:")).toBe(true);
    const rel = saved.memories.relationships[trainer.id];
    expect(rel.bond).toBe(NEW_BOND + BOND_DAILY_SWING);
    expect(rel.callsThem).toBe("Eli");
    expect(rel.notes).toHaveLength(1);
    expect(rel.notes![0]).toContain("2026-11-02:");
    for (const e of saved.memories.episodic) expect(validateMember("episodicEvent", e)).toEqual([]);
    expect(validateMember("relationships", saved.memories.relationships)).toEqual([]);

    const journal = await t.db.query.event.findFirst({ where: eq(schema.event.id, result.journal.id) });
    expect(journal).toMatchObject({ kind: "other", rolledUp: true, importance: 2, trainerId: null });
    expect(journal!.summary.length).toBeLessThanOrEqual(280);
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
    const generate = answering({ summary: "Eli fed me twice today. I like the oran ones best. ".repeat(60), callsThem: "Big Eli", notes: ["gives the good berries", "sings off key"], bondDelta: 4 }, 500);
    const result = await rollupDay({ db: t.db, trainer: eli, row, events, now: NIGHT }, { generate, model: "fake", budget: { configured: true } });
    expect(result.source).toBe("model");
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
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

  it("runs from the nightly rollover and marks the events rolled up", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    await dayOf(eli.id, row.id, 4);
    const result = await rollover(t.db, NIGHT);
    expect(result.eventsRolledUp).toBeGreaterThanOrEqual(4);
    const pending = await t.db.query.event.findMany({ where: eq(schema.event.rolledUp, false) });
    expect(pending).toEqual([]);
    const saved = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(saved.memories.summary.length).toBeGreaterThan(0);
    expect(saved.memories.episodic.length).toBeGreaterThanOrEqual(5);
  });
});

describe("rules helpers", () => {
  it("clipSummary ends at a sentence when it can", () => {
    const text = "One sentence here. Two sentences here. ".repeat(100);
    const clipped = clipSummary(text, 300);
    expect(clipped.length).toBeLessThanOrEqual(300);
    expect(clipped.endsWith(".…")).toBe(true);
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
