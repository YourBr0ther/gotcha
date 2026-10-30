/**
 * Mini-game rounds. `startRound` issues a signed round token; `submitRound`
 * takes the token back with the result, pays through the engine's
 * miniGamePayout, and writes the ledger, the balance and the active
 * pokemon's experience in one transaction.
 *
 * Tokens are stateless: HMAC over { round, trainer, game, issuedAt }. The
 * ledger row the payout writes (reason `minigame`, ref `<game>:<round>`)
 * is what stops a token from being scored twice, and a zero-Bytes round
 * past the daily cap still writes one so the day's game count is right.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { addExperience, MINIGAME_DAILY_CAP, MINUTE, miniGamePayout, SECOND, type DayTotals, type Payout } from "@/lib/sim";
import { schema, type Db, type DbOrTx } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { findManifest, type GameManifestData } from "@/games/manifests";
import { publish } from "./bus";
import { ServiceError } from "./errors";
import { logEngineEvents } from "./pokemon";
import { displayName, pokemonView } from "./views";

export const MINIGAME_REASON = "minigame";
/** A token older than this is refused even with a sound signature. */
export const ROUND_TTL_MS = 30 * MINUTE;
/** Allowance for client clocks and request latency when comparing durationMs to the wall clock. */
export const CLOCK_SLACK_MS = 10 * SECOND;

interface RoundClaims {
  r: string;
  t: string;
  g: string;
  i: number;
}

let processSecret: Buffer | null = null;

/** GAMES_ROUND_SECRET, or a secret made at boot. The fallback only costs a round in flight across a restart. */
function secret(): Buffer {
  const env = process.env.GAMES_ROUND_SECRET?.trim();
  if (env) return Buffer.from(env, "utf8");
  processSecret ??= randomBytes(32);
  return processSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * At most this many scored rounds per rolling day. The Bytes cap already
 * bounds currency; this bounds experience and keeps a scripted client from
 * grinding the 0.1 floor of the payout curve all night.
 */
export const MAX_ROUNDS_PER_DAY = 24;

/**
 * One open round per trainer, held in process memory. Starting a round
 * invalidates the previous token, so tokens cannot be stockpiled and played
 * back later. A restart forgets open rounds; the client just starts again.
 */
const openRounds = new Map<string, string>();

export function issueRoundToken(trainerId: string, gameId: string, now: string): { token: string; roundId: string } {
  const claims: RoundClaims = { r: randomUUID(), t: trainerId, g: gameId, i: Date.parse(now) };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  openRounds.set(trainerId, claims.r);
  return { token: `${payload}.${sign(payload)}`, roundId: claims.r };
}

/** The claims inside a token, or null when the signature or the shape is wrong. */
export function readRoundToken(token: string): RoundClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(payload), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<RoundClaims>;
    if (typeof claims.r !== "string" || typeof claims.t !== "string" || typeof claims.g !== "string" || typeof claims.i !== "number") return null;
    return claims as RoundClaims;
  } catch {
    return null;
  }
}

export function ledgerRef(gameId: string, roundId: string): string {
  return `${gameId}:${roundId}`;
}

/**
 * Mini-game rows in the last 24 hours, summed. A rolling window rather than
 * the trainer's local day: the timezone is trainer-editable, and flipping it
 * would reopen a day that was already capped.
 */
export const DAY_WINDOW_MS = 24 * 60 * MINUTE;

export async function dayTotalsFor(db: DbOrTx, trainer: Pick<TrainerRow, "id">, now: string): Promise<DayTotals> {
  const since = new Date(Date.parse(now) - DAY_WINDOW_MS).toISOString();
  const rows = await db
    .select({ delta: schema.ledger.delta })
    .from(schema.ledger)
    .where(and(eq(schema.ledger.trainerId, trainer.id), eq(schema.ledger.reason, MINIGAME_REASON), gte(schema.ledger.at, since)));
  let bytesEarned = 0;
  for (const row of rows) bytesEarned += row.delta;
  return { gamesPlayed: rows.length, bytesEarned };
}

function requireManifest(gameId: string): GameManifestData {
  const manifest = findManifest(gameId);
  if (!manifest) throw new ServiceError("not_found", `no game called "${gameId}"`);
  return manifest;
}

async function activePokemon(db: DbOrTx, trainerId: string, lock: boolean): Promise<PokemonRow | null> {
  const query = db
    .select()
    .from(schema.pokemon)
    .where(and(eq(schema.pokemon.trainerId, trainerId), eq(schema.pokemon.active, true), eq(schema.pokemon.status, "home")));
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

export interface RoundPokemon {
  id: string;
  name: string;
  species: string;
  level: number;
}

function roundPokemon(row: PokemonRow): RoundPokemon {
  return { id: row.id, name: displayName(row), species: row.identity.species, level: row.stats.level };
}

export interface RoundStart {
  gameId: string;
  roundId: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  dayTotals: DayTotals;
  cap: number;
  /** What a perfect round would pay right now. */
  perfectPays: Payout;
  pokemon: RoundPokemon | null;
}

export async function startRound(db: Db, trainer: TrainerRow, gameId: string, now = new Date().toISOString()): Promise<RoundStart> {
  const manifest = requireManifest(gameId);
  const active = await activePokemon(db, trainer.id, false);
  if (active && active.stats.level < manifest.minimumLevel) {
    throw new ServiceError("bad_request", `${manifest.name} needs a level ${manifest.minimumLevel} pokemon; ${displayName(active)} is level ${active.stats.level}`);
  }
  const dayTotals = await dayTotalsFor(db, trainer, now);
  const { token, roundId } = issueRoundToken(trainer.id, gameId, now);
  return {
    gameId,
    roundId,
    token,
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + ROUND_TTL_MS).toISOString(),
    dayTotals,
    cap: MINIGAME_DAILY_CAP,
    perfectPays: miniGamePayout({ game: gameId, score: 1, durationMs: manifest.seconds * 1000, completed: true }, dayTotals),
    pokemon: active ? roundPokemon(active) : null,
  };
}

export interface RoundSubmission {
  token: string;
  gameId: string;
  score: number;
  maxScore: number;
  durationMs: number;
  perfect: boolean;
}

export interface RoundOutcome {
  gameId: string;
  roundId: string;
  /** 0 to 1, what the engine was paid on. */
  score: number;
  perfect: boolean;
  bytes: number;
  experience: number;
  /** After this round. */
  dayTotals: DayTotals;
  cap: number;
  balance: number;
  levelsGained: number[];
  pokemon: RoundPokemon | null;
}

function checkSubmission(trainer: TrainerRow, input: RoundSubmission, manifest: GameManifestData, now: string): RoundClaims {
  const claims = readRoundToken(input.token);
  if (!claims) throw new ServiceError("bad_request", "round token is not valid");
  if (claims.t !== trainer.id) throw new ServiceError("bad_request", "round token belongs to another trainer");
  if (claims.g !== input.gameId) throw new ServiceError("bad_request", "round token is for another game");
  const age = Date.parse(now) - claims.i;
  if (age < -CLOCK_SLACK_MS) throw new ServiceError("bad_request", "round token is from the future");
  if (age > ROUND_TTL_MS) throw new ServiceError("bad_request", "round token has expired; start a new round");

  if (!Number.isFinite(input.score) || !Number.isFinite(input.maxScore) || input.maxScore <= 0) throw new ServiceError("bad_request", "score and maxScore must be finite and maxScore positive");
  if (input.score < 0) throw new ServiceError("bad_request", "score cannot be negative");
  if (input.score > input.maxScore) throw new ServiceError("bad_request", "score cannot be above maxScore");
  if (!Number.isInteger(input.durationMs)) throw new ServiceError("bad_request", "durationMs must be a whole number");
  if (input.durationMs < manifest.durationMs.min || input.durationMs > manifest.durationMs.max) {
    throw new ServiceError("bad_request", `a ${manifest.name} round lasts between ${manifest.durationMs.min} and ${manifest.durationMs.max} ms`);
  }
  if (input.durationMs > age + CLOCK_SLACK_MS) throw new ServiceError("bad_request", "durationMs is longer than the round has existed");
  return claims;
}

export async function submitRound(db: Db, trainer: TrainerRow, input: RoundSubmission, now = new Date().toISOString()): Promise<RoundOutcome> {
  const manifest = requireManifest(input.gameId);
  const claims = checkSubmission(trainer, input, manifest, now);
  const ref = ledgerRef(input.gameId, claims.r);
  const normalized = Math.max(0, Math.min(1, input.score / input.maxScore));
  // The client reports its own score; replaying a touch game on the server is
  // not worth it for a family app. What the server does own is whether the
  // round counts as perfect, and the daily caps that bound any cheating.
  const perfect = normalized >= 1;

  const { outcome, view } = await db.transaction(async (tx) => {
    // The trainer lock serialises rounds per trainer, so the replay check and the day totals are read under it.
    const [locked] = await tx.select({ bytes: schema.trainer.bytes }).from(schema.trainer).where(eq(schema.trainer.id, trainer.id)).for("update");
    if (!locked) throw new ServiceError("not_found", "trainer not found");
    const replay = await tx.query.ledger.findFirst({
      where: and(eq(schema.ledger.trainerId, trainer.id), eq(schema.ledger.reason, MINIGAME_REASON), eq(schema.ledger.ref, ref)),
    });
    if (replay) throw new ServiceError("already_present", "this round was already scored");
    if (openRounds.get(trainer.id) !== claims.r) throw new ServiceError("bad_request", "this is not the trainer's open round; start a new round");

    const before = await dayTotalsFor(tx, trainer, now);
    if (before.gamesPlayed >= MAX_ROUNDS_PER_DAY) throw new ServiceError("bad_request", `that is ${MAX_ROUNDS_PER_DAY} rounds today; the games open again tomorrow`);
    openRounds.delete(trainer.id);
    const payout = miniGamePayout({ game: input.gameId, score: normalized, durationMs: input.durationMs, completed: true }, before);
    const balance = locked.bytes + payout.bytes;
    if (payout.bytes !== 0) await tx.update(schema.trainer).set({ bytes: balance }).where(eq(schema.trainer.id, trainer.id));
    await tx.insert(schema.ledger).values({ trainerId: trainer.id, delta: payout.bytes, reason: MINIGAME_REASON, ref, at: now });

    const active = await activePokemon(tx, trainer.id, true);
    let experience = 0;
    let levelsGained: number[] = [];
    let view = null;
    if (active) {
      if (active.stats.level < manifest.minimumLevel) throw new ServiceError("bad_request", `${manifest.name} needs a level ${manifest.minimumLevel} pokemon`);
      const grown = addExperience(active.stats, payout.experience, now);
      experience = payout.experience;
      levelsGained = grown.levelsGained;
      await tx.update(schema.pokemon).set({ stats: grown.stats, updatedAt: now }).where(eq(schema.pokemon.id, active.id));
      const name = displayName(active);
      const how = perfect ? "a perfect round" : normalized >= 0.6 ? "a good round" : "a round";
      await tx.insert(schema.event).values({
        pokemonId: active.id,
        ts: now,
        kind: "play",
        summary: `${trainer.displayName} played ${how} of ${manifest.name} with ${name}`,
        importance: perfect ? 2 : 1,
        trainerId: trainer.id,
        emotion: perfect ? "thrilled" : normalized >= 0.6 ? "happy" : "content",
      });
      await logEngineEvents(tx, active, grown.events, trainer.id, trainer.displayName);
      view = await pokemonView({ ...active, stats: grown.stats }, trainer, now);
    }

    const outcome: RoundOutcome = {
      gameId: input.gameId,
      roundId: claims.r,
      score: normalized,
      perfect,
      bytes: payout.bytes,
      experience,
      dayTotals: { gamesPlayed: before.gamesPlayed + 1, bytesEarned: before.bytesEarned + payout.bytes },
      cap: MINIGAME_DAILY_CAP,
      balance,
      levelsGained,
      pokemon: active ? { ...roundPokemon(active), level: grown(active, levelsGained) } : null,
    };
    return { outcome, view };
  });

  if (view) publish(view.id, { type: "state", view, cause: `minigame:${input.gameId}` });
  return outcome;
}

function grown(row: PokemonRow, levelsGained: number[]): number {
  return levelsGained.length ? levelsGained[levelsGained.length - 1] : row.stats.level;
}
