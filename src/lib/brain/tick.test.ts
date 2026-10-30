import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { subscribe, type BusMessage } from "@/lib/services/bus";
import { brainTick } from "@/lib/services/brain-hook";
import { insertPokemon, makeTrainer, T0 } from "@/lib/services/testing";
import { pokemonView } from "@/lib/services/views";
import { LINE_MAX_CHARS } from "./constants";
import { answering, fixture, hanging, mockModel } from "./test/helpers";
import { buildTickContext, decideTick, validatePlan, type TickInput } from "./tick";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("brain_tick");
  await t.truncate();
});
afterAll(() => t?.cleanup());

/** T0 is 20:00 UTC; the trainer is on UTC so it is evening, not night. */
async function setup(needs: Partial<Record<string, number>> = {}, watched = true): Promise<TickInput> {
  const trainer = await makeTrainer(t.db, "eli", "Eli");
  const inserted = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
  if (Object.keys(needs).length > 0) {
    await t.db
      .update(schema.pokemon)
      .set({ state: { ...inserted.state, needs: { ...inserted.state.needs, ...needs } } })
      .where(eq(schema.pokemon.id, inserted.id));
  }
  const row = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, inserted.id) }))!;
  const view = await pokemonView(row, trainer, T0);
  return { db: t.db, trainer, row, view, now: T0, watched };
}

async function events(pokemonId: string) {
  return t.db.query.event.findMany({ where: eq(schema.event.pokemonId, pokemonId), orderBy: (e, { asc }) => [asc(e.id)] });
}

describe("decideTick", () => {
  it("takes a plan the menu allows, logs the line as a talk event, and tells the bus", async () => {
    const input = await setup();
    const messages: BusMessage[] = [];
    const off = subscribe(input.row.id, (m) => messages.push(m));
    try {
      const decision = await decideTick(input, { generate: answering(fixture("tick-response.json"), 40), model: "fake", budget: { configured: true } });
      expect(decision).toMatchObject({ activity: "walk", emote: "happy", cry: true, source: "model" });
      expect(decision.line).toBe("Vee! Good grass today, want to run laps around the log");
    } finally {
      off();
    }
    expect(messages).toMatchObject([{ type: "brain", activity: "walk", emote: "happy", dialogue: expect.stringContaining("Good grass") }]);
    const logged = await events(input.row.id);
    const talk = logged.find((e) => e.kind === "talk");
    expect(talk).toMatchObject({ summary: 'Vee said "Vee! Good grass today, want to run laps around the log"', trainerId: input.trainer.id, emotion: "happy", importance: 1 });
    const saved = await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, input.row.id) });
    expect(saved?.state.activity).toBe("walk");
    expect(saved?.state.needs).toEqual(input.row.state.needs);
  });

  it("goes through the real generateObject with a mock SDK model", async () => {
    const input = await setup();
    const decision = await decideTick(input, { model: mockModel(fixture("tick-response.json")), budget: { configured: true }, publish: false });
    expect(decision.source).toBe("model");
    expect(decision.activity).toBe("walk");
    const usage = await t.db.query.brainUsage.findFirst({ where: eq(schema.brainUsage.pokemonId, input.row.id) });
    expect(usage).toMatchObject({ tickCalls: 1, tokens: 150 });
  });

  it("falls back to rules when the model picks something not on the menu", async () => {
    const input = await setup();
    // Eevee avoids water, so swim is never offered; a fully rested pokemon in the evening is not offered sleep either.
    const ctx = await buildTickContext(input);
    expect(ctx.menu.activities).not.toContain("swim");
    const offMenu = await decideTick(input, { generate: answering({ activity: "swim", cry: false }), model: "fake", budget: { configured: true }, publish: false });
    expect(offMenu).toMatchObject({ source: "rules", reason: "rejected" });
    expect(ctx.menu.activities).toContain(offMenu.activity);
    const badShape = await decideTick(input, { generate: answering({ activity: "dance", emote: "wink" }), model: "fake", budget: { configured: true }, publish: false });
    expect(badShape).toMatchObject({ source: "rules", reason: "rejected" });
    expect(validatePlan({ activity: "idle", emote: "music", cry: false }, { activities: ["idle"], emotes: ["sad"], canMisbehave: false })).toBeNull();
  });

  it("falls back to rules on a timeout", async () => {
    const input = await setup();
    const decision = await decideTick(input, { generate: hanging(), model: "fake", budget: { configured: true, timeoutMs: 25 }, publish: false });
    expect(decision).toMatchObject({ source: "rules", reason: "timeout" });
    expect(["idle", "walk"]).toContain(decision.activity);
  });

  it("falls back to rules, tagged, once the day's cap is spent", async () => {
    const input = await setup();
    const generate = answering(fixture("tick-response.json"));
    const deps = { generate, model: "fake", budget: { configured: true, caps: { tickCalls: 1 } }, publish: false };
    expect((await decideTick(input, deps)).source).toBe("model");
    const capped = await decideTick(input, deps);
    expect(capped).toMatchObject({ source: "rules", reason: "cap" });
    expect(generate.calls).toBe(1);
  });

  it("clips a long line and drops an emote the menu did not offer", async () => {
    const input = await setup();
    const line = "Vee vee vee! ".repeat(20);
    const decision = await decideTick(input, { generate: answering({ activity: "idle", line, cry: false }), model: "fake", budget: { configured: true }, publish: false });
    expect(decision.source).toBe("model");
    expect(decision.line!.length).toBeLessThanOrEqual(LINE_MAX_CHARS);
    const logged = await events(input.row.id);
    expect(logged.find((e) => e.kind === "talk")?.summary.length).toBeLessThanOrEqual(LINE_MAX_CHARS + 20);
  });

  it("sets the misbehaving flag only when the menu allowed it", async () => {
    const content = await setup();
    await decideTick(content, { generate: answering({ activity: "idle", cry: false, misbehaving: true }), model: "fake", budget: { configured: true }, publish: false });
    expect((await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, content.row.id) }))?.state.flags?.misbehaving).toBeFalsy();

    await t.truncate();
    const bored = await setup({ fun: 15 });
    expect((await buildTickContext(bored)).menu.canMisbehave).toBe(true);
    const decision = await decideTick(bored, { generate: answering({ activity: "idle", cry: false, misbehaving: true }), model: "fake", budget: { configured: true }, publish: false });
    expect(decision.misbehaving).toBe(true);
    const saved = await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, bored.row.id) });
    expect(saved?.state.flags?.misbehaving).toBe(true);
    expect(saved?.state.needs.fun).toBe(15);
  });

  it("puts the pokemon to sleep when it chooses sleep and the engine's gate allows it", async () => {
    const tired = await setup({ energy: 20 });
    const messages: BusMessage[] = [];
    const off = subscribe(tired.row.id, (m) => messages.push(m));
    try {
      const decision = await decideTick(tired, { generate: answering({ activity: "sleep", emote: "sleepy", cry: false }), model: "fake", budget: { configured: true } });
      expect(decision).toMatchObject({ activity: "sleep", source: "model" });
    } finally {
      off();
    }
    const saved = await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, tired.row.id) });
    expect(saved?.state.asleep).toBe(true);
    expect(saved?.state.sleepStartedAt).toBe(T0);
    expect(saved?.state.activity).toBe("sleep");
    expect(messages.map((m) => m.type)).toEqual(["state", "brain"]);
    expect((await events(tired.row.id)).some((e) => e.summary === "Vee fell asleep")).toBe(true);
  });

  it("a line said to nobody is logged as other, without a trainer", async () => {
    const input = await setup({}, false);
    await decideTick(input, { generate: answering({ activity: "idle", line: "vee?", cry: false }), model: "fake", budget: { configured: true }, publish: false });
    const logged = await events(input.row.id);
    expect(logged.find((e) => e.summary.includes("vee?"))).toMatchObject({ kind: "other", trainerId: null });
  });

  it("the scheduler hook answers by rules with no key at all", async () => {
    const input = await setup();
    const result = await brainTick(input);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ source: "rules" });
    expect(["idle", "walk"]).toContain(result!.activity);
    expect(await t.db.query.brainUsage.findMany()).toEqual([]);
  });
});
