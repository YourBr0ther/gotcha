import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSigner, generatePrivateKey, publicKeyFromPrivate, unpack } from "@gotcha/cpkmn";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { HOUR, milestoneBonus } from "@/lib/sim";
import { care } from "./care";
import { getParty } from "./party";
import { insertPokemon, later, makeTrainer, T0 } from "./testing";
import { exportPokemon, importPokemon, keyFile, TRADE_TTL, type SigningConfig } from "./transfer";

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
    expect(after.memories).toEqual(memories);
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
