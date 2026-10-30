import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { HOUR, MINIGAME_DAILY_CAP, MINIGAME_FLOOR, miniGameMultiplier, miniGamePayout, type DayTotals } from "@/lib/sim";
import { MANIFESTS } from "@/games/manifests";
import { CLOCK_SLACK_MS, dayTotalsFor, issueRoundToken, ledgerRef, MINIGAME_REASON, readRoundToken, ROUND_TTL_MS, startRound, submitRound } from "./games";
import { giveBytes, insertPokemon, later, makeTrainer, T0 } from "./testing";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("games");
  await t.truncate();
});
afterAll(() => t?.cleanup());

const berry = MANIFESTS.find((m) => m.id === "berry-catch")!;
const whack = MANIFESTS.find((m) => m.id === "whack-a-diglett")!;
const ROUND_MS = berry.seconds * 1000;

/** Starts at `at` and submits a round that lasted ROUND_MS, as the client would. */
async function playRound(trainer: Awaited<ReturnType<typeof makeTrainer>>, at: string, score = 1, maxScore = 1, gameId = berry.id, durationMs = ROUND_MS) {
  const start = await startRound(t.db, trainer, gameId, at);
  const now = later(at, durationMs + 500);
  return { start, outcome: await submitRound(t.db, trainer, { token: start.token, gameId, score, maxScore, durationMs, perfect: score === maxScore }, now) };
}

describe("round tokens", () => {
  it("round-trip and refuse tampering", () => {
    const { token, roundId } = issueRoundToken("trainer-a", "berry-catch", T0);
    expect(readRoundToken(token)).toEqual({ r: roundId, t: "trainer-a", g: "berry-catch", i: Date.parse(T0) });
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ r: roundId, t: "trainer-b", g: "berry-catch", i: Date.parse(T0) })).toString("base64url");
    expect(readRoundToken(`${forged}.${sig}`)).toBeNull();
    expect(readRoundToken(`${payload}.${sig.slice(1)}x`)).toBeNull();
    expect(readRoundToken("nonsense")).toBeNull();
    expect(readRoundToken("")).toBeNull();
  });
});

describe("games", () => {
  it("pays what the engine says and writes ledger, balance, experience and the play event together", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli", "Eli"), 10);
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });

    const { start, outcome } = await playRound(trainer, T0);
    expect(start.dayTotals).toEqual({ gamesPlayed: 0, bytesEarned: 0 });
    expect(start.perfectPays).toEqual(miniGamePayout({ game: berry.id, score: 1, durationMs: ROUND_MS, completed: true }, { gamesPlayed: 0, bytesEarned: 0 }));
    expect(start.pokemon).toMatchObject({ id: row.id, name: "Vee", species: "eevee" });

    const expected = miniGamePayout({ game: berry.id, score: 1, durationMs: ROUND_MS, completed: true }, { gamesPlayed: 0, bytesEarned: 0 });
    expect(outcome.bytes).toBe(expected.bytes);
    expect(outcome.experience).toBe(expected.experience);
    expect(outcome.balance).toBe(10 + expected.bytes);
    expect(outcome.dayTotals).toEqual({ gamesPlayed: 1, bytesEarned: expected.bytes });
    expect(outcome.cap).toBe(MINIGAME_DAILY_CAP);
    expect(outcome.score).toBe(1);

    const saved = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(saved?.bytes).toBe(10 + expected.bytes);
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger.map((l) => [l.delta, l.reason, l.ref])).toEqual([[expected.bytes, MINIGAME_REASON, ledgerRef(berry.id, start.roundId)]]);
    const pokemon = await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) });
    expect(pokemon?.stats.experience).toBe(row.stats.experience + expected.experience);
    // A fresh starter levels up on its first fifteen experience, which lands in the log next to the play.
    expect(outcome.levelsGained).toEqual([2]);
    expect(outcome.pokemon?.level).toBe(2);
    const events = await t.db.query.event.findMany({ where: eq(schema.event.pokemonId, row.id), orderBy: (e, { asc }) => [asc(e.id)] });
    expect(events.map((e) => [e.kind, e.summary])).toEqual([
      ["play", "Eli played a perfect round of Berry Catch with Vee"],
      ["milestone", "Vee reached level 2"],
    ]);
  });

  it("follows the daily curve: each round pays the engine's multiplier for the games already played", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await insertPokemon(t.db, trainer, { slot: 1, active: true });
    let totals: DayTotals = { gamesPlayed: 0, bytesEarned: 0 };
    for (let i = 0; i < 4; i++) {
      const at = later(T0, i * 2 * ROUND_MS);
      const { outcome } = await playRound(trainer, at, 7, 10);
      const expected = miniGamePayout({ game: berry.id, score: 0.7, durationMs: ROUND_MS, completed: true }, totals);
      expect(outcome.bytes).toBe(expected.bytes);
      expect(outcome.experience).toBe(expected.experience);
      totals = { gamesPlayed: totals.gamesPlayed + 1, bytesEarned: totals.bytesEarned + expected.bytes };
      expect(outcome.dayTotals).toEqual(totals);
    }
    expect(miniGameMultiplier(3)).toBeLessThan(1);
  });

  it("holds the daily cap and still counts rounds played past it", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await insertPokemon(t.db, trainer, { slot: 1, active: true });
    let at = T0;
    let totals: DayTotals = { gamesPlayed: 0, bytesEarned: 0 };
    let rounds = 0;
    while (totals.bytesEarned < MINIGAME_DAILY_CAP && rounds < 80) {
      const { outcome } = await playRound(trainer, at);
      expect(outcome.dayTotals.bytesEarned).toBeLessThanOrEqual(MINIGAME_DAILY_CAP);
      expect(outcome.bytes).toBeGreaterThan(0);
      totals = outcome.dayTotals;
      at = later(at, ROUND_MS + 1000);
      rounds += 1;
    }
    expect(totals.bytesEarned).toBe(MINIGAME_DAILY_CAP);
    // The floor keeps every round paying at least a little, so the cap is reached within the same day.
    expect(rounds).toBeLessThanOrEqual(Math.ceil(MINIGAME_DAILY_CAP / (20 * MINIGAME_FLOOR)));
    expect(later(T0, rounds * (ROUND_MS + 1000)) < later(T0, 24 * HOUR)).toBe(true);

    const { outcome: capped } = await playRound(trainer, at);
    expect(capped.bytes).toBe(0);
    expect(capped.experience).toBeGreaterThan(0);
    expect(capped.dayTotals).toEqual({ gamesPlayed: rounds + 1, bytesEarned: MINIGAME_DAILY_CAP });
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger).toHaveLength(rounds + 1);
    expect(ledger.reduce((sum, l) => sum + l.delta, 0)).toBe(MINIGAME_DAILY_CAP);
    const saved = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(saved?.bytes).toBe(MINIGAME_DAILY_CAP);
  });

  it("starts a fresh day in the trainer's timezone", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await t.db.update(schema.trainer).set({ timezone: "America/New_York" }).where(eq(schema.trainer.id, trainer.id));
    const nyTrainer = (await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) }))!;
    // 03:30 UTC is still the evening before in New York.
    const lateEvening = "2026-11-03T03:30:00.000Z";
    await playRound(nyTrainer, lateEvening);
    expect(await dayTotalsFor(t.db, nyTrainer, later(lateEvening, 30 * 60 * 1000))).toMatchObject({ gamesPlayed: 1 });
    // 05:30 UTC is past midnight in New York: a new day.
    expect(await dayTotalsFor(t.db, nyTrainer, "2026-11-03T05:30:00.000Z")).toEqual({ gamesPlayed: 0, bytesEarned: 0 });
    // Seen from UTC the same rows would still be today.
    expect(await dayTotalsFor(t.db, { id: trainer.id, timezone: "UTC" }, "2026-11-03T05:30:00.000Z")).toMatchObject({ gamesPlayed: 1 });
  });

  it("refuses a replayed token", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const start = await startRound(t.db, trainer, berry.id, T0);
    const now = later(T0, ROUND_MS + 500);
    const body = { token: start.token, gameId: berry.id, score: 1, maxScore: 1, durationMs: ROUND_MS, perfect: true };
    await submitRound(t.db, trainer, body, now);
    await expect(submitRound(t.db, trainer, body, now)).rejects.toMatchObject({ code: "already_present" });
    await expect(submitRound(t.db, trainer, { ...body, score: 0 }, later(now, 1000))).rejects.toMatchObject({ code: "already_present" });
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger).toHaveLength(1);
  });

  it("refuses a score above max, a negative score, and a bad maxScore", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const start = await startRound(t.db, trainer, berry.id, T0);
    const now = later(T0, ROUND_MS + 500);
    const body = { token: start.token, gameId: berry.id, score: 11, maxScore: 10, durationMs: ROUND_MS, perfect: false };
    await expect(submitRound(t.db, trainer, body, now)).rejects.toMatchObject({ code: "bad_request", message: /above maxScore/ });
    await expect(submitRound(t.db, trainer, { ...body, score: -1 }, now)).rejects.toMatchObject({ code: "bad_request" });
    await expect(submitRound(t.db, trainer, { ...body, score: 0, maxScore: 0 }, now)).rejects.toMatchObject({ code: "bad_request" });
    await expect(submitRound(t.db, trainer, { ...body, score: Number.NaN }, now)).rejects.toMatchObject({ code: "bad_request" });
    // Nothing was written, so the token is still good.
    const ok = await submitRound(t.db, trainer, { ...body, score: 10 }, now);
    expect(ok.score).toBe(1);
  });

  it("refuses durations outside the manifest or longer than the round has existed", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const start = await startRound(t.db, trainer, berry.id, T0);
    const base = { token: start.token, gameId: berry.id, score: 1, maxScore: 1, perfect: true };
    await expect(submitRound(t.db, trainer, { ...base, durationMs: berry.durationMs.min - 1 }, later(T0, ROUND_MS))).rejects.toMatchObject({ code: "bad_request" });
    await expect(submitRound(t.db, trainer, { ...base, durationMs: berry.durationMs.max + 1 }, later(T0, berry.durationMs.max + 2000))).rejects.toMatchObject({ code: "bad_request" });
    await expect(submitRound(t.db, trainer, { ...base, durationMs: 1000.5 }, later(T0, ROUND_MS))).rejects.toMatchObject({ code: "bad_request" });
    // Claiming a full minute five seconds after the token was issued.
    await expect(submitRound(t.db, trainer, { ...base, durationMs: ROUND_MS }, later(T0, ROUND_MS - CLOCK_SLACK_MS - 5000))).rejects.toMatchObject({
      code: "bad_request",
      message: /longer than the round has existed/,
    });
  });

  it("refuses a token for another trainer, another game, or an expired one", async () => {
    const eli = await makeTrainer(t.db, "eli");
    const mia = await makeTrainer(t.db, "mia");
    const start = await startRound(t.db, eli, berry.id, T0);
    const now = later(T0, ROUND_MS + 500);
    const body = { token: start.token, gameId: berry.id, score: 1, maxScore: 1, durationMs: ROUND_MS, perfect: true };
    await expect(submitRound(t.db, mia, body, now)).rejects.toMatchObject({ code: "bad_request", message: /another trainer/ });
    await expect(submitRound(t.db, eli, { ...body, gameId: whack.id, durationMs: whack.seconds * 1000 }, now)).rejects.toMatchObject({ code: "bad_request", message: /another game/ });
    await expect(submitRound(t.db, eli, { ...body, token: "nope.nope" }, now)).rejects.toMatchObject({ code: "bad_request", message: /not valid/ });
    await expect(submitRound(t.db, eli, body, later(T0, ROUND_TTL_MS + 1000))).rejects.toMatchObject({ code: "bad_request", message: /expired/ });
    await expect(submitRound(t.db, eli, { ...body, gameId: "tetris" }, now)).rejects.toMatchObject({ code: "not_found" });
    await expect(startRound(t.db, eli, "tetris", T0)).rejects.toMatchObject({ code: "not_found" });
  });

  it("pays Bytes with no active pokemon and grants no experience", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const { outcome } = await playRound(trainer, T0);
    expect(outcome.bytes).toBeGreaterThan(0);
    expect(outcome.experience).toBe(0);
    expect(outcome.pokemon).toBeNull();
  });
});
