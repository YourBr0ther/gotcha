import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createSigner, generatePrivateKey, publicKeyFromPrivate, unpack } from "@gotcha/cpkmn";
import { toEpisodic } from "@/lib/brain/events";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { HOUR, milestoneBonus } from "@/lib/sim";
import { care } from "./care";
import { getParty } from "./party";
import { deposit, release } from "./pc";
import { insertPokemon, later, makeTrainer, T0 } from "./testing";
import { exportPokemon, importPokemon, keyFile, TRADE_TTL, type SigningConfig } from "./transfer";

/** Every event row of a pokemon, oldest first, as the roll-up and the export order them. */
async function eventRows(pokemonId: string) {
  return t.db.query.event.findMany({ where: eq(schema.event.pokemonId, pokemonId), orderBy: [asc(schema.event.ts), asc(schema.event.id)] });
}

let t: TestDb;
let signed: SigningConfig;
let stranger: SigningConfig;

beforeEach(async () => {
  t ??= await createTestDb("transfer");
  await t.truncate();
  if (!signed) {
    const key = generatePrivateKey();
    const publicKey = await publicKeyFromPrivate(key);
    signed = { signer: createSigner(key, "test#2026-11"), keyId: "test#2026-11", publicKey, knownKeys: { "test#2026-11": publicKey }, installId: "test#2026-11" };
    const other = generatePrivateKey();
    stranger = { signer: createSigner(other, "elsewhere#2026-11"), keyId: "elsewhere#2026-11", publicKey: await publicKeyFromPrivate(other), knownKeys: {}, installId: "elsewhere#2026-11" };
  }
});
afterAll(() => t?.cleanup());

describe("export and import", () => {
  it("round trips a backup: export, delete, import keeps nickname, needs and memories, and is verified", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
    await care(t.db, trainer, row.id, { action: "pet" }, later(T0, HOUR));
    const memories = { summary: "# Vee\n\nLikes Eli.\n", episodic: [{ ts: T0, kind: "care" as const, summary: "Eli petted me", importance: 2 as const }], relationships: { [trainer.id]: { bond: 60 } } };
    await t.db.update(schema.pokemon).set({ memories }).where(eq(schema.pokemon.id, row.id));
    const before = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;

    const exported = await exportPokemon(t.db, trainer, row.id, "backup", later(T0, 2 * HOUR), signed);
    expect(exported.contentType).toBe("application/vnd.gotcha.cpkmn");
    expect(exported.filename).toBe(`vee-${row.id.slice(0, 8)}.cpkmn`);
    const peek = await unpack(exported.bytes, { knownKeys: signed.knownKeys });
    expect(peek.verification).toBe("verified");
    expect(peek.manifest.assetMode).toBe("reference");
    expect(peek.pokemon.trade).toBeUndefined();
    // The stored summary is kept; the pet, not rolled up yet, follows the stored memory in episodic.
    const pending = await eventRows(row.id);
    expect(pending.length).toBeGreaterThan(0);
    expect(peek.pokemon.memories.summary).toBe(memories.summary);
    expect(peek.pokemon.memories.episodic).toEqual([...memories.episodic, ...pending.map(toEpisodic)]);
    // A backup does not change the row.
    expect((await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))?.status).toBe("home");

    await t.db.delete(schema.event).where(eq(schema.event.pokemonId, row.id));
    await t.db.delete(schema.pokemon).where(eq(schema.pokemon.id, row.id));

    const importedAt = later(T0, 30 * HOUR);
    const result = await importPokemon(t.db, trainer, exported.bytes, importedAt, signed);
    expect(result.outcome).toBe("new");
    expect(result.verification).toBe("verified");
    expect(result.bytesAwarded).toBe(milestoneBonus("first_import"));
    const after = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(after.identity.nickname).toBe("Vee");
    expect(after.state.needs).toEqual(before.state.needs);
    // Stasis: the file's time in transit did not decay it.
    expect(after.state.lastTickAt).toBe(importedAt);
    expect(after.memories).toEqual(peek.pokemon.memories);
    expect(after.stats).toEqual(before.stats);
    expect(after.history.imports).toEqual([{ at: importedAt, install: "test#2026-11", verification: "verified" }]);
    expect(after.status).toBe("home");
    expect(after.active).toBe(true);
  });

  it("marks a file signed by an unknown key unverified, and an unsigned one unsigned", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const foreign = await exportPokemon(t.db, trainer, row.id, "backup", T0, stranger);
    await t.db.delete(schema.pokemon).where(eq(schema.pokemon.id, row.id));
    const result = await importPokemon(t.db, trainer, foreign.bytes, T0, signed);
    expect(result.verification).toBe("unverified");
    expect(result.warnings.some((w) => w.code === "signature_invalid")).toBe(true);

    const row2 = await insertPokemon(t.db, trainer, { slot: 2 });
    const unsigned = await exportPokemon(t.db, trainer, row2.id, "backup", T0, { knownKeys: {}, installId: "nokey" });
    await t.db.delete(schema.pokemon).where(eq(schema.pokemon.id, row2.id));
    expect((await importPokemon(t.db, trainer, unsigned.bytes, T0, signed)).verification).toBe("unsigned");
  });

  it("refuses an import whose pokemon is already here, and garbage", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const backup = await exportPokemon(t.db, trainer, row.id, "backup", T0, signed);
    await expect(importPokemon(t.db, trainer, backup.bytes, T0, signed)).rejects.toMatchObject({ code: "already_present" });
    await expect(importPokemon(t.db, trainer, new TextEncoder().encode("not a zip"), T0, signed)).rejects.toMatchObject({ code: "bad_file" });
  });

  it("trade lock: trade export locks the row, care is refused, importing it home cancels the trade", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const spare = await insertPokemon(t.db, trainer, { slot: 2 });

    const exported = await exportPokemon(t.db, trainer, row.id, "trade", T0, signed);
    expect(exported.trade?.nonce).toHaveLength(32);
    const peek = await unpack(exported.bytes, { knownKeys: signed.knownKeys });
    expect(peek.pokemon.trade).toMatchObject({ nonce: exported.trade!.nonce, fromTrainerId: trainer.id, toTrainerId: null });

    const locked = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(locked).toMatchObject({ status: "in_transit", slot: null, active: false });
    expect((await getParty(t.db, trainer, T0)).activeId).toBe(spare.id);
    const offered = await t.db.query.trade.findFirst({ where: eq(schema.trade.nonce, exported.trade!.nonce) });
    expect(offered).toMatchObject({ state: "offered", pokemonId: row.id, fromTrainerId: trainer.id });

    await expect(care(t.db, trainer, row.id, { action: "pet" }, T0)).rejects.toMatchObject({ code: "in_transit" });
    await expect(exportPokemon(t.db, trainer, row.id, "trade", T0, signed)).rejects.toMatchObject({ code: "in_transit" });

    const home = await importPokemon(t.db, trainer, exported.bytes, later(T0, HOUR), signed);
    expect(home.outcome).toBe("returned");
    expect(home.tradeNonce).toBe(exported.trade!.nonce);
    expect(home.bytesAwarded).toBe(0);
    const cancelled = await t.db.query.trade.findFirst({ where: eq(schema.trade.nonce, exported.trade!.nonce) });
    expect(cancelled?.state).toBe("cancelled");
    const back = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(back).toMatchObject({ status: "home", slot: 1, trainerId: trainer.id });
    expect(back.history.trades).toEqual([]);
    // Care works again.
    expect((await care(t.db, trainer, row.id, { action: "pet" }, later(T0, HOUR))).refused).toBe(false);
  });

  it("another trainer importing an in_transit file confirms the trade and takes ownership", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const mae = await makeTrainer(t.db, "mae", "Mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const exported = await exportPokemon(t.db, eli, row.id, "trade", T0, signed);

    const received = await importPokemon(t.db, mae, exported.bytes, later(T0, HOUR), signed);
    expect(received.outcome).toBe("received");
    const confirmed = await t.db.query.trade.findFirst({ where: eq(schema.trade.nonce, exported.trade!.nonce) });
    expect(confirmed).toMatchObject({ state: "confirmed", toTrainerId: mae.id });
    const moved = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(moved.trainerId).toBe(mae.id);
    expect(moved.identity.currentTrainer).toEqual({ trainerId: mae.id, name: "Mae" });
    expect(moved.identity.originalTrainer.trainerId).toBe(eli.id);
    expect(moved.history.trainers.map((t) => [t.trainerId, t.to === null || t.to === undefined])).toEqual([
      [eli.id, false],
      [mae.id, true],
    ]);
    expect(moved.history.trades).toHaveLength(1);
    expect(moved.history.trades[0]).toMatchObject({ verified: true });
    expect((await getParty(t.db, mae, T0)).activeId).toBe(row.id);
    expect((await getParty(t.db, eli, T0)).party).toEqual([]);
  });

  it("an arrival lands in the PC when the party is full", async () => {
    const eli = await makeTrainer(t.db, "eli");
    const mae = await makeTrainer(t.db, "mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    for (let slot = 1; slot <= 6; slot++) await insertPokemon(t.db, mae, { slot, active: slot === 1 });
    const exported = await exportPokemon(t.db, eli, row.id, "trade", T0, signed);
    const received = await importPokemon(t.db, mae, exported.bytes, T0, signed);
    expect(received.view).toMatchObject({ status: "pc", box: 1, boxSlot: 1, active: false });
  });

  it("publishes the key file for other installs", async () => {
    expect(await keyFile(signed)).toEqual({ keys: [{ keyId: "test#2026-11", alg: "ed25519", publicKey: signed.publicKey }] });
    expect(await keyFile({ knownKeys: {}, installId: "x" })).toEqual({ keys: [] });
  });
});

describe("import hardening", () => {
  async function deleteRow(id: string) {
    await t.db.delete(schema.event).where(eq(schema.event.pokemonId, id));
    await t.db.delete(schema.pokemon).where(eq(schema.pokemon.id, id));
  }

  it("a stranger cannot take an in_transit pokemon with a file that lacks the trade nonce", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const mae = await makeTrainer(t.db, "mae", "Mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    // A backup made before the trade is a signed, valid file with the right id and no trade.json.
    const backup = await exportPokemon(t.db, eli, row.id, "backup", T0, signed);
    await exportPokemon(t.db, eli, row.id, "trade", later(T0, HOUR), signed);

    await expect(importPokemon(t.db, mae, backup.bytes, later(T0, 2 * HOUR), signed)).rejects.toMatchObject({ code: "trade_mismatch" });
    // And the owner cannot "return" it with the stale backup either; they need the trade file.
    await expect(importPokemon(t.db, eli, backup.bytes, later(T0, 2 * HOUR), signed)).rejects.toMatchObject({ code: "trade_mismatch" });
    const still = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(still).toMatchObject({ status: "in_transit", trainerId: eli.id });
  });

  it("a stranger needs a verified signature to receive a trade; the owner does not to bring it home", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const mae = await makeTrainer(t.db, "mae", "Mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    // Signed by a key this install does not know.
    const exported = await exportPokemon(t.db, eli, row.id, "trade", T0, stranger);

    await expect(importPokemon(t.db, mae, exported.bytes, later(T0, HOUR), signed)).rejects.toMatchObject({ code: "unverified_file" });
    const home = await importPokemon(t.db, eli, exported.bytes, later(T0, HOUR), signed);
    expect(home.outcome).toBe("returned");
    expect(home.verification).toBe("unverified");
  });

  it("an expired trade offer cannot be received, but the owner can still bring the pokemon home", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const mae = await makeTrainer(t.db, "mae", "Mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const exported = await exportPokemon(t.db, eli, row.id, "trade", T0, signed);
    const late = later(T0, TRADE_TTL + HOUR);

    await expect(importPokemon(t.db, mae, exported.bytes, late, signed)).rejects.toMatchObject({ code: "trade_expired" });
    const home = await importPokemon(t.db, eli, exported.bytes, late, signed);
    expect(home.outcome).toBe("returned");
  });

  it("the first-import bonus is paid once per trainer and only for verified files", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    const c = await insertPokemon(t.db, trainer, { slot: 3 });
    const fileA = await exportPokemon(t.db, trainer, a.id, "backup", T0, signed);
    const fileB = await exportPokemon(t.db, trainer, b.id, "backup", T0, signed);
    const fileC = await exportPokemon(t.db, trainer, c.id, "backup", T0, { knownKeys: {}, installId: "nokey" });
    await deleteRow(a.id);
    await deleteRow(b.id);
    await deleteRow(c.id);

    // Unsigned first: no bonus, and it does not consume the once-per-trainer bonus.
    expect((await importPokemon(t.db, trainer, fileC.bytes, later(T0, HOUR), signed)).bytesAwarded).toBe(0);
    expect((await importPokemon(t.db, trainer, fileA.bytes, later(T0, HOUR), signed)).bytesAwarded).toBe(milestoneBonus("first_import"));
    expect((await importPokemon(t.db, trainer, fileB.bytes, later(T0, HOUR), signed)).bytesAwarded).toBe(0);
    const me = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(me?.bytes).toBe(milestoneBonus("first_import"));
  });
});

describe("memories in the file", () => {
  it("a backup taken before the roll-up carries the day's events and a stand-in summary; the event rows are untouched", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
    await care(t.db, trainer, row.id, { action: "pet" }, later(T0, HOUR));
    await care(t.db, trainer, row.id, { action: "play" }, later(T0, 2 * HOUR));
    await care(t.db, trainer, row.id, { action: "groom" }, later(T0, 3 * HOUR));
    const rowsBefore = await eventRows(row.id);
    expect(rowsBefore.length).toBeGreaterThanOrEqual(3);
    expect(rowsBefore.every((e) => !e.rolledUp)).toBe(true);

    const exported = await exportPokemon(t.db, trainer, row.id, "backup", later(T0, 4 * HOUR), signed);
    const peek = await unpack(exported.bytes, { knownKeys: signed.knownKeys });
    const expected = rowsBefore.map(toEpisodic);
    expect(peek.pokemon.memories.episodic).toEqual(expected);
    const last = expected[expected.length - 1].summary;
    expect(peek.pokemon.memories.summary).toBe(`Hatched on 2026-11-02. ${expected.length} things have happened so far, most recently ${last}.`);

    // Export reads. It marks nothing rolled up and leaves the row's memories alone.
    expect(await eventRows(row.id)).toEqual(rowsBefore);
    const stored = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(stored.memories).toEqual({ summary: "", episodic: [], relationships: {} });

    // Into an install that has never seen the pokemon, the entries are what it remembers.
    await t.db.delete(schema.event).where(eq(schema.event.pokemonId, row.id));
    await t.db.delete(schema.pokemon).where(eq(schema.pokemon.id, row.id));
    const result = await importPokemon(t.db, trainer, exported.bytes, later(T0, 30 * HOUR), signed);
    expect(result.outcome).toBe("new");
    const after = (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) }))!;
    expect(after.memories).toEqual(peek.pokemon.memories);
  });

  it("a pokemon with nothing in its log exports an empty episodic and a one-line summary", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const exported = await exportPokemon(t.db, trainer, row.id, "backup", T0, signed);
    const peek = await unpack(exported.bytes, { knownKeys: signed.knownKeys });
    expect(peek.pokemon.memories.episodic).toEqual([]);
    expect(peek.pokemon.memories.summary).toBe("Hatched on 2026-11-02. Nothing has happened yet.");
  });

  it("a trade file carries the day's events, not the trade event written after the pack", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await care(t.db, trainer, row.id, { action: "pet" }, later(T0, HOUR));
    const rowsBefore = await eventRows(row.id);
    const exported = await exportPokemon(t.db, trainer, row.id, "trade", later(T0, 2 * HOUR), signed);
    const peek = await unpack(exported.bytes, { knownKeys: signed.knownKeys });
    expect(peek.pokemon.memories.episodic).toEqual(rowsBefore.map(toEpisodic));
    const rowsAfter = await eventRows(row.id);
    expect(rowsAfter).toHaveLength(rowsBefore.length + 1);
    expect(rowsAfter.every((e) => !e.rolledUp)).toBe(true);
  });
});

describe("restoring a released pokemon", () => {
  async function load(id: string) {
    return (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, id) }))!;
  }

  it("release keeps the row but clears slot, box and active", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    await deposit(t.db, trainer, b.id);
    expect(await load(b.id)).toMatchObject({ status: "pc", box: 1, boxSlot: 1 });
    await release(t.db, trainer, a.id);
    await release(t.db, trainer, b.id);
    for (const id of [a.id, b.id]) {
      expect(await load(id)).toMatchObject({ status: "released", slot: null, box: null, boxSlot: null, active: false, trainerId: trainer.id });
    }
  });

  it("the trainer who released a pokemon restores it from its backup: home, first free slot, stasis, milestone, the file wins", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
    const spare = await insertPokemon(t.db, trainer, { slot: 2 });
    await care(t.db, trainer, row.id, { action: "pet" }, later(T0, HOUR));
    const backedUp = await load(row.id);
    const exported = await exportPokemon(t.db, trainer, row.id, "backup", later(T0, 2 * HOUR), signed);
    const peek = await unpack(exported.bytes, { knownKeys: signed.knownKeys });
    const carried = new Set((await eventRows(row.id)).map((e) => e.id));

    // Life goes on after the backup, then the pokemon is let go.
    await care(t.db, trainer, row.id, { action: "groom" }, later(T0, 3 * HOUR));
    await release(t.db, trainer, row.id);
    expect((await getParty(t.db, trainer, later(T0, 3 * HOUR))).activeId).toBe(spare.id);

    const restoredAt = later(T0, 30 * HOUR);
    const result = await importPokemon(t.db, trainer, exported.bytes, restoredAt, signed);
    expect(result).toMatchObject({ outcome: "restored", verification: "verified", tradeNonce: null, bytesAwarded: 0 });
    const after = await load(row.id);
    expect(after).toMatchObject({ status: "home", slot: 1, box: null, boxSlot: null, active: false, trainerId: trainer.id });
    expect((await getParty(t.db, trainer, restoredAt)).activeId).toBe(spare.id);
    // Stasis, and the backup is the source of truth: the groom after it is gone from the state.
    expect(after.state.lastTickAt).toBe(restoredAt);
    expect(after.state.needs).toEqual(backedUp.state.needs);
    expect(after.stats).toEqual(backedUp.stats);
    expect(after.identity).toEqual(backedUp.identity);
    expect(after.memories).toEqual(peek.pokemon.memories);
    expect(after.history.milestones).toEqual([expect.objectContaining({ at: restoredAt, kind: "restored" })]);
    expect(after.history.imports).toEqual([{ at: restoredAt, install: "test#2026-11", verification: "verified" }]);
    expect(after.history.trades).toEqual([]);
    expect(after.history.trainers).toEqual(backedUp.history.trainers);

    // The event rows the file carried are marked rolled up, so the roll-up does not
    // record them twice; what happened after the backup, and the restore, still wait for it.
    const rows = await eventRows(row.id);
    expect(rows.filter((e) => carried.has(e.id)).every((e) => e.rolledUp)).toBe(true);
    const waiting = rows.filter((e) => !e.rolledUp);
    expect(waiting.every((e) => !carried.has(e.id))).toBe(true);
    expect(waiting.map((e) => e.summary)).toContain("Came back to Eli from a backup");

    expect((await care(t.db, trainer, row.id, { action: "pet" }, restoredAt)).refused).toBe(false);
  });

  it("a restored pokemon lands in the PC when the party is full", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const exported = await exportPokemon(t.db, trainer, row.id, "backup", T0, signed);
    await release(t.db, trainer, row.id);
    for (let slot = 1; slot <= 6; slot++) await insertPokemon(t.db, trainer, { slot, active: slot === 1 });
    const result = await importPokemon(t.db, trainer, exported.bytes, later(T0, HOUR), signed);
    expect(result.outcome).toBe("restored");
    expect(result.view).toMatchObject({ status: "pc", box: 1, boxSlot: 1, active: false });
  });

  it("a stranger cannot restore someone else's released pokemon, signed or not", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const mae = await makeTrainer(t.db, "mae", "Mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const backup = await exportPokemon(t.db, eli, row.id, "backup", T0, signed);
    const unsigned = await exportPokemon(t.db, eli, row.id, "backup", T0, { knownKeys: {}, installId: "nokey" });
    await release(t.db, eli, row.id);

    await expect(importPokemon(t.db, mae, backup.bytes, later(T0, HOUR), signed)).rejects.toMatchObject({ code: "already_present" });
    await expect(importPokemon(t.db, mae, unsigned.bytes, later(T0, HOUR), signed)).rejects.toMatchObject({ code: "already_present" });
    expect(await load(row.id)).toMatchObject({ status: "released", trainerId: eli.id });
    expect((await getParty(t.db, mae, T0)).party).toEqual([]);
  });

  it("the owner the file names restores with a verified file after someone else released it; an unverified file is refused", async () => {
    const eli = await makeTrainer(t.db, "eli", "Eli");
    const mae = await makeTrainer(t.db, "mae", "Mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true });
    const verified = await exportPokemon(t.db, eli, row.id, "backup", T0, signed);
    const unverified = await exportPokemon(t.db, eli, row.id, "backup", T0, stranger);

    // Traded to Mae on this install, then Mae lets it go.
    const offer = await exportPokemon(t.db, eli, row.id, "trade", later(T0, HOUR), signed);
    expect((await importPokemon(t.db, mae, offer.bytes, later(T0, 2 * HOUR), signed)).outcome).toBe("received");
    await release(t.db, mae, row.id);

    await expect(importPokemon(t.db, eli, unverified.bytes, later(T0, 3 * HOUR), signed)).rejects.toMatchObject({ code: "already_present" });
    const result = await importPokemon(t.db, eli, verified.bytes, later(T0, 3 * HOUR), signed);
    expect(result.outcome).toBe("restored");
    const after = await load(row.id);
    expect(after).toMatchObject({ status: "home", slot: 1, trainerId: eli.id });
    expect(after.identity.currentTrainer).toEqual({ trainerId: eli.id, name: "Eli" });
    expect(after.history.trainers.filter((h) => h.to == null).map((h) => h.trainerId)).toEqual([eli.id]);
    expect((await getParty(t.db, eli, later(T0, 3 * HOUR))).activeId).toBe(row.id);
    expect((await getParty(t.db, mae, later(T0, 3 * HOUR))).party).toEqual([]);
  });

  it("the owner can restore from a trade file that already came home; the dead offer stays dead", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const offer = await exportPokemon(t.db, trainer, row.id, "trade", T0, signed);
    expect((await importPokemon(t.db, trainer, offer.bytes, later(T0, HOUR), signed)).outcome).toBe("returned");
    await release(t.db, trainer, row.id);

    const result = await importPokemon(t.db, trainer, offer.bytes, later(T0, 2 * HOUR), signed);
    expect(result).toMatchObject({ outcome: "restored", tradeNonce: null });
    expect(await load(row.id)).toMatchObject({ status: "home", slot: 1, trainerId: trainer.id });
    expect((await load(row.id)).history.trades).toEqual([]);
    expect((await t.db.query.trade.findFirst({ where: eq(schema.trade.nonce, offer.trade!.nonce) }))?.state).toBe("cancelled");
  });
});
