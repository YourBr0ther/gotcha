import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { subscribe, type BusMessage } from "@/lib/services/bus";
import { insertPokemon, makeTrainer, T0 } from "@/lib/services/testing";
import { bumpBond, NEW_BOND, talkTo, validateReply } from "./converse";
import { BOND_PER_TALK, LINE_MAX_CHARS, TRAINER_TEXT_MAX_CHARS } from "./constants";
import { answering, fixture, mockModel } from "./test/helpers";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("brain_converse");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("talkTo", () => {
  it("refuses a stranger's pokemon and one out for trade", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const sam = await makeTrainer(t.db, "sam", "Sam");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    await expect(talkTo(t.db, sam, row.id, "hello", T0)).rejects.toMatchObject({ code: "not_found", status: 404 });
    const away = await insertPokemon(t.db, sam, { slot: 1, status: "in_transit" });
    await expect(talkTo(t.db, sam, away.id, "hello", T0)).rejects.toMatchObject({ code: "in_transit", status: 409 });
    const boxed = await insertPokemon(t.db, sam, { status: "pc", slot: null, box: 1, boxSlot: 1 });
    await expect(talkTo(t.db, sam, boxed.id, "hello", T0)).rejects.toMatchObject({ code: "not_home" });
    await expect(talkTo(t.db, eli, row.id, "   ", T0)).rejects.toMatchObject({ code: "bad_request" });
    expect(await t.db.query.event.findMany({ where: eq(schema.event.kind, "talk") })).toEqual([]);
  });

  it("answers by rules with no key, logs the exchange and warms the bond", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true, nickname: "Vee" });
    const messages: BusMessage[] = [];
    const off = subscribe(row.id, (m) => messages.push(m));
    let reply;
    try {
      reply = await talkTo(t.db, eli, row.id, "who's a good Eevee?", T0);
    } finally {
      off();
    }
    expect(reply.source).toBe("rules");
    expect(reply.reason).toBe("unconfigured");
    expect(reply.line.length).toBeLessThanOrEqual(LINE_MAX_CHARS);
    expect(messages).toMatchObject([{ type: "brain", dialogue: reply.line, emote: reply.emote }]);
    const talk = await t.db.query.event.findFirst({ where: eq(schema.event.pokemonId, row.id) });
    expect(talk).toMatchObject({ kind: "talk", importance: 1, trainerId: eli.id });
    expect(talk?.summary).toContain(`Eli said "who's a good Eevee?"; Vee answered "${reply.line}"`);
    const saved = await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) });
    expect(saved?.memories.relationships[eli.id]).toMatchObject({ bond: NEW_BOND + BOND_PER_TALK, callsThem: "Eli", lastSeenAt: T0 });
  });

  it("uses the model's reply, its importance, and its activity when the menu allows", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true, nickname: "Vee" });
    const reply = await talkTo(t.db, eli, row.id, "good morning!", T0, { generate: answering(fixture("talk-response.json"), 33), model: "fake", budget: { configured: true } });
    expect(reply).toMatchObject({ source: "model", emote: "love", cry: true, activity: "idle" });
    expect(reply.line).toContain("Vee-vee!");
    const talk = await t.db.query.event.findFirst({ where: eq(schema.event.pokemonId, row.id) });
    expect(talk).toMatchObject({ importance: 2, emotion: "affectionate" });
    const usage = await t.db.query.brainUsage.findFirst({ where: eq(schema.brainUsage.pokemonId, row.id) });
    expect(usage).toMatchObject({ talkCalls: 1, tickCalls: 0, tokens: 33 });
  });

  it("goes through generateObject with a mock SDK model and clips the trainer's text", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const text = "a".repeat(TRAINER_TEXT_MAX_CHARS + 50);
    const reply = await talkTo(t.db, eli, row.id, text, T0, { model: mockModel(fixture("talk-response.json")), budget: { configured: true } });
    expect(reply.source).toBe("model");
    const talk = await t.db.query.event.findFirst({ where: eq(schema.event.pokemonId, row.id) });
    expect(talk!.summary.length).toBeLessThanOrEqual(280);
  });

  it("rejects an emote or activity the menu did not offer and answers by rules instead", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const reply = await talkTo(t.db, eli, row.id, "swim!", T0, { generate: answering({ line: "ok", emote: "happy", cry: true, activity: "swim" }), model: "fake", budget: { configured: true } });
    expect(reply).toMatchObject({ source: "rules", reason: "rejected" });
    expect(validateReply({ line: "", emote: "happy", cry: true }, { activities: ["idle"], emotes: ["happy"], canMisbehave: false })).toBeNull();
    expect(validateReply({ line: "hi", emote: "angry", cry: true }, { activities: ["idle"], emotes: ["happy"], canMisbehave: false })).toBeNull();
  });

  it("bumpBond stays inside 0..100", () => {
    expect(bumpBond({ bond: 100 }, "Eli", T0).bond).toBe(100);
    expect(bumpBond(undefined, "Eli", T0)).toMatchObject({ bond: NEW_BOND + BOND_PER_TALK, callsThem: "Eli" });
  });
});
