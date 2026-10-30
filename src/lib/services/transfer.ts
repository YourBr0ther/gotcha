/**
 * Export and import of .cpkmn files, and the trade lock around them.
 *
 * Backup: pack the row, nothing changes. Trade: pack with trade.json, mark
 * the row in_transit; it cannot be cared for, made active or exported again
 * until a file with the same pokemonId comes back. Both modes fold the
 * event rows the nightly roll-up has not reached yet into the file's
 * episodic memories (see memoriesForExport), so a backup taken mid-day
 * still carries the day.
 *
 * Import: the file's pokemonId decides. Unknown id: a new arrival. Known
 * and in_transit: the original trainer importing cancels the trade (home);
 * another trainer importing confirms it (a same-install trade). Known and
 * released: the trainer who released it, or the owner the file names with a
 * verified file, restores it from the backup. Known and home or in the PC:
 * refused, the pokemon is already here.
 */

import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  CpkmnError,
  createSigner,
  pack,
  publicKeyFromPrivate,
  trimEpisodic,
  unpack,
  type CpkmnPokemon,
  type EpisodicEvent,
  type KeyFile,
  type KnownKeys,
  type Memories,
  type Signer,
  type Trade,
  type Verification,
  type Warning,
} from "@gotcha/cpkmn";
import { toEpisodic } from "@/lib/brain/events";
import { DAY, milestoneBonus } from "@/lib/sim";
import { schema, type Db, type DbOrTx } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { reconcileActive } from "./party";
import { assertTouchable, freeBoxSlot, freeSlot, lockAll } from "./pokemon";
import { assetPackFor } from "./species";
import { adjustBytes } from "./trainers";
import { displayName, localDay, pokemonView, type PokemonView } from "./views";

export const GENERATOR = { name: "gotcha", version: "0.1.0" };
export const TRADE_TTL = 7 * DAY;
export const CPKMN_CONTENT_TYPE = "application/vnd.gotcha.cpkmn";

export type ExportMode = "backup" | "trade";

export interface SigningConfig {
  signer?: Signer;
  keyId?: string;
  publicKey?: string;
  knownKeys: KnownKeys;
  /** Written to history as this install's name. */
  installId: string;
}

let envConfig: Promise<SigningConfig> | null = null;

/** CPKMN_SIGNING_KEY and CPKMN_KEY_ID; without them exports are unsigned. */
export function signingFromEnv(): Promise<SigningConfig> {
  envConfig ??= (async () => {
    const privateKey = process.env.CPKMN_SIGNING_KEY?.trim();
    const keyId = (process.env.CPKMN_KEY_ID ?? process.env.CPKMN_SIGNING_KEY_ID)?.trim();
    const knownKeys: KnownKeys = {};
    const extra = process.env.CPKMN_KNOWN_KEYS?.trim();
    if (extra) {
      try {
        Object.assign(knownKeys, JSON.parse(extra) as KnownKeys);
      } catch {
        console.warn("CPKMN_KNOWN_KEYS is not a JSON object of keyId to public key; ignoring it");
      }
    }
    if (!privateKey || !keyId) return { knownKeys, installId: keyId ?? "gotcha" };
    const signer = createSigner(privateKey, keyId);
    const publicKey = await publicKeyFromPrivate(privateKey);
    knownKeys[keyId] = publicKey;
    return { signer, keyId, publicKey, knownKeys, installId: keyId };
  })();
  return envConfig;
}

export async function keyFile(config?: SigningConfig): Promise<KeyFile> {
  const c = config ?? (await signingFromEnv());
  return { keys: c.keyId && c.publicKey ? [{ keyId: c.keyId, alg: "ed25519", publicKey: c.publicKey }] : [] };
}

export function rowToPokemon(row: PokemonRow): CpkmnPokemon {
  return {
    identity: row.identity,
    stats: row.stats,
    state: row.state,
    personality: row.personality,
    memories: row.memories,
    pokedex: row.pokedex,
    inventory: row.inventory,
    history: row.history,
  };
}

/** Event rows the nightly roll-up has not folded into memories yet, oldest first. */
async function pendingEvents(db: DbOrTx, pokemonId: string) {
  return db.query.event.findMany({
    where: and(eq(schema.event.pokemonId, pokemonId), eq(schema.event.rolledUp, false)),
    orderBy: (e, { asc }) => [asc(e.ts), asc(e.id)],
  });
}

function episodicKey(e: EpisodicEvent): string {
  return `${e.ts}\u0000${e.kind}\u0000${e.summary}`;
}

/** The stand-in for an empty summary: one paragraph from the rules, no model. */
export function placeholderSummary(row: Pick<PokemonRow, "identity">, timezone: string, episodic: readonly EpisodicEvent[]): string {
  const hatched = `Hatched on ${localDay(timezone, row.identity.hatchedAt)}.`;
  if (episodic.length === 0) return `${hatched} Nothing has happened yet.`;
  const n = episodic.length;
  const last = episodic[episodic.length - 1].summary.replace(/\.$/, "");
  return `${hatched} ${n} ${n === 1 ? "thing has" : "things have"} happened so far, most recently ${last}.`;
}

/**
 * What the file carries as memories: the row's rolled-up memories plus the
 * event rows the roll-up has not reached, as episodic entries, newest last,
 * cut to the spec's limit. Read only: the rows stay unrolled for the
 * roll-up and no model is called. An empty summary gets a rules stand-in so
 * a file exported on the pokemon's first day still says something.
 */
export async function memoriesForExport(db: DbOrTx, row: PokemonRow, timezone: string): Promise<Memories> {
  const pending = await pendingEvents(db, row.id);
  const episodic = trimEpisodic([...row.memories.episodic, ...pending.map(toEpisodic)]);
  const summary = row.memories.summary.trim() ? row.memories.summary : placeholderSummary(row, timezone, episodic);
  return { ...row.memories, summary, episodic };
}

function filenameFor(row: PokemonRow, mode: ExportMode): string {
  const base = displayName(row)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || row.identity.species}-${row.id.slice(0, 8)}${mode === "trade" ? "-trade" : ""}.cpkmn`;
}

export interface ExportResult {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  mode: ExportMode;
  trade?: Trade;
}

export async function exportPokemon(db: Db, trainer: TrainerRow, pokemonId: string, mode: ExportMode, now = new Date().toISOString(), config?: SigningConfig): Promise<ExportResult> {
  const c = config ?? (await signingFromEnv());
  const row = await db.query.pokemon.findFirst({ where: and(eq(schema.pokemon.id, pokemonId), eq(schema.pokemon.trainerId, trainer.id)) });
  if (!row || row.status === "released") throw new ServiceError("not_found", "pokemon not found");
  assertTouchable(row);

  const pokemon: CpkmnPokemon = { ...rowToPokemon(row), memories: await memoriesForExport(db, row, trainer.timezone) };
  // Assets are referenced by hash: both installs extract the same Cobblemon pack.
  const assetPack = await assetPackFor(row.identity.species);
  const packOptions = { assetMode: "reference" as const, assetPack, signer: c.signer, generator: GENERATOR, now };

  if (mode === "backup") {
    const bytes = await pack(pokemon, packOptions);
    return { bytes, filename: filenameFor(row, mode), contentType: CPKMN_CONTENT_TYPE, mode };
  }

  const trade: Trade = {
    nonce: randomBytes(16).toString("hex"),
    fromTrainerId: trainer.id,
    toTrainerId: null,
    offeredAt: now,
    expiresAt: new Date(Date.parse(now) + TRADE_TTL).toISOString(),
  };
  const bytes = await pack({ ...pokemon, trade }, packOptions);

  await db.transaction(async (tx) => {
    const rows = await lockAll(tx, trainer.id);
    const locked = rows.find((r) => r.id === row.id);
    if (!locked) throw new ServiceError("not_found", "pokemon not found");
    assertTouchable(locked);
    await tx.insert(schema.trade).values({
      nonce: trade.nonce,
      pokemonId: row.id,
      fromTrainerId: trainer.id,
      toTrainerId: null,
      state: "offered",
      offeredAt: trade.offeredAt,
      expiresAt: trade.expiresAt,
    });
    await tx
      .update(schema.pokemon)
      .set({ status: "in_transit", slot: null, active: false, box: null, boxSlot: null, updatedAt: now })
      .where(eq(schema.pokemon.id, row.id));
    Object.assign(locked, { status: "in_transit", slot: null, active: false, box: null, boxSlot: null });
    await tx.insert(schema.event).values({
      pokemonId: row.id,
      ts: now,
      kind: "trade",
      summary: `${trainer.displayName} sent ${displayName(row)} off to be traded`,
      importance: 4,
      trainerId: trainer.id,
      emotion: "nervous",
    });
    await reconcileActive(tx, rows);
  });

  return { bytes, filename: filenameFor(row, mode), contentType: CPKMN_CONTENT_TYPE, mode, trade };
}

/**
 * new: the id was unknown here. returned: the owner brought an in_transit
 * pokemon home. received: a trade was confirmed to the importer. restored:
 * a released pokemon came back from its backup.
 */
export type ImportOutcome = "new" | "returned" | "received" | "restored";

export interface ImportResult {
  view: PokemonView;
  outcome: ImportOutcome;
  verification: Verification;
  warnings: Warning[];
  /** The trade this import closed, if any. */
  tradeNonce: string | null;
  bytesAwarded: number;
}

/**
 * Who may bring a released pokemon back. The trainer who released it, with
 * any file: the row is theirs and the file only has to carry the id. The
 * trainer the file names as current owner, with a verified file: the
 * signature is what stops a hand-built file from claiming someone else's
 * release. Anyone else needs a live trade offer matching the file's nonce,
 * the same bar as an in_transit arrival.
 */
async function claimReleased(tx: DbOrTx, existing: PokemonRow, pokemon: CpkmnPokemon, trainer: TrainerRow, verification: Verification, now: string): Promise<{ outcome: ImportOutcome; tradeNonce: string | null }> {
  if (existing.trainerId === trainer.id) return { outcome: "restored", tradeNonce: null };
  // Only server-side state decides a restore. The file's currentTrainer is
  // whatever the exporter wrote, and a stale backup from before a trade must
  // not undo that trade.

  const nonce = pokemon.trade?.nonce;
  const [offer] = nonce
    ? await tx
        .select()
        .from(schema.trade)
        .where(and(eq(schema.trade.nonce, nonce), eq(schema.trade.pokemonId, existing.id)))
        .for("update")
    : [];
  const live =
    offer !== undefined &&
    verification === "verified" &&
    offer.state === "offered" &&
    Date.parse(offer.expiresAt) > Date.parse(now) &&
    (!offer.toTrainerId || offer.toTrainerId === trainer.id);
  if (!live) throw new ServiceError("already_present", "that pokemon was released by another trainer here; only they can restore it");
  await tx.update(schema.trade).set({ state: "confirmed", toTrainerId: trainer.id }).where(eq(schema.trade.nonce, offer.nonce));
  return { outcome: "received", tradeNonce: offer.nonce };
}

export async function importPokemon(db: Db, trainer: TrainerRow, bytes: Uint8Array, now = new Date().toISOString(), config?: SigningConfig): Promise<ImportResult> {
  const c = config ?? (await signingFromEnv());
  let unpacked: Awaited<ReturnType<typeof unpack>>;
  try {
    unpacked = await unpack(bytes, { knownKeys: c.knownKeys });
  } catch (error) {
    if (error instanceof CpkmnError) throw new ServiceError("bad_file", `${error.code}: ${error.message}`, { code: error.code, member: error.member });
    throw error;
  }
  const { pokemon, manifest, verification, warnings } = unpacked;
  const id = pokemon.identity.pokemonId;
  const fromInstall = manifest.signature?.keyId ?? manifest.generator.name;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.pokemon).where(eq(schema.pokemon.id, id)).for("update");
    let outcome: ImportOutcome;
    let tradeNonce: string | null = null;

    if (existing && existing.status === "released") {
      ({ outcome, tradeNonce } = await claimReleased(tx, existing, pokemon, trainer, verification, now));
    } else if (existing) {
      if (existing.status !== "in_transit") throw new ServiceError("already_present", "that pokemon is already here");
      const open = await tx
        .select()
        .from(schema.trade)
        .where(and(eq(schema.trade.pokemonId, id), inArray(schema.trade.state, ["offered", "expired"])))
        .for("update");
      outcome = existing.trainerId === trainer.id ? "returned" : "received";

      // The file must carry the nonce of this pokemon's outstanding trade.
      // Without this check anyone who knew a pokemonId could hand-build a
      // file and take over a pokemon that is out for trade.
      const fileNonce = pokemon.trade?.nonce ?? null;
      const match = fileNonce ? open.find((t) => t.nonce === fileNonce) : undefined;
      if (open.length > 0 && !match) {
        throw new ServiceError("trade_mismatch", "this file does not match the pokemon's outstanding trade");
      }

      if (outcome === "received") {
        // A stranger taking ownership needs a file this install, or a known
        // install, actually signed, and a live trade addressed to them (or to
        // anyone). The owner bringing their own pokemon home needs neither.
        if (verification !== "verified") throw new ServiceError("unverified_file", "trades are only accepted from signed files with a known key");
        if (!match) throw new ServiceError("trade_mismatch", "no outstanding trade for this pokemon");
        if (match.state !== "offered" || Date.parse(match.expiresAt) <= Date.parse(now)) {
          throw new ServiceError("trade_expired", "this trade offer has expired; the owner can still bring the pokemon home");
        }
        if (match.toTrainerId && match.toTrainerId !== trainer.id) throw new ServiceError("trade_mismatch", "this trade was offered to someone else");
      }

      if (open.length > 0) {
        tradeNonce = match?.nonce ?? open[open.length - 1].nonce;
        await tx
          .update(schema.trade)
          .set(outcome === "returned" ? { state: "cancelled" } : { state: "confirmed", toTrainerId: trainer.id })
          .where(inArray(schema.trade.nonce, open.map((t) => t.nonce)));
      }
    } else {
      outcome = "new";
    }

    const trainerRef = { trainerId: trainer.id, name: trainer.displayName };
    const identity = { ...pokemon.identity, currentTrainer: trainerRef };
    const history = structuredClone(pokemon.history);
    history.imports.push({ at: now, install: c.installId, verification });
    if (outcome !== "returned") {
      for (const t of history.trainers) if (t.to == null && t.trainerId !== trainer.id) t.to = now;
      if (!history.trainers.some((t) => t.trainerId === trainer.id && t.to == null)) {
        history.trainers.push({ trainerId: trainer.id, name: trainer.displayName, from: now, to: null });
      }
      if (outcome !== "restored" && (pokemon.trade || outcome === "received")) {
        history.trades.push({ at: now, fromInstall: outcome === "received" ? c.installId : fromInstall, toInstall: c.installId, verified: verification === "verified" });
      }
    }
    if (outcome === "restored") history.milestones.push({ at: now, kind: "restored", detail: `From a backup taken ${manifest.exportedAt}` });
    // Stasis: the time in the file does not count.
    const state = { ...pokemon.state, lastTickAt: now };

    const rows = await lockAll(tx, trainer.id);
    const slot = freeSlot(rows);
    const placement = slot !== null ? { status: "home" as const, slot, box: null, boxSlot: null } : { status: "pc" as const, slot: null, ...freeBoxSlot(rows) };
    const values = {
      trainerId: trainer.id,
      identity,
      stats: pokemon.stats,
      state,
      personality: pokemon.personality,
      memories: pokemon.memories,
      pokedex: pokemon.pokedex,
      inventory: pokemon.inventory,
      history,
      active: false,
      modifiers: [],
      updatedAt: now,
      ...placement,
    };
    let row: PokemonRow;
    if (existing) {
      [row] = await tx.update(schema.pokemon).set(values).where(eq(schema.pokemon.id, id)).returning();
    } else {
      [row] = await tx
        .insert(schema.pokemon)
        .values({ id, createdAt: now, ...values })
        .returning();
    }
    rows.push(row);
    await reconcileActive(tx, rows);

    if (existing) {
      // The export folded this install's unrolled event rows into the file,
      // and the file's memories now sit on the row. Those rows would reach
      // memories a second time at the next roll-up, so the ones the file
      // carries are marked rolled up. Rows the file does not carry (anything
      // after the export, the trade event itself) stay for the roll-up.
      const carried = new Set(pokemon.memories.episodic.map(episodicKey));
      const dup = (await pendingEvents(tx, id)).filter((e) => carried.has(episodicKey(toEpisodic(e))));
      if (dup.length > 0) {
        await tx
          .update(schema.event)
          .set({ rolledUp: true })
          .where(inArray(schema.event.id, dup.map((e) => e.id)));
      }
    }

    const summary =
      outcome === "returned"
        ? `Came back home to ${trainer.displayName}`
        : outcome === "restored"
          ? `Came back to ${trainer.displayName} from a backup`
          : outcome === "received"
            ? `Traded to ${trainer.displayName}`
            : `Arrived at ${trainer.displayName}'s from ${fromInstall} (${verification})`;
    const relieved = outcome === "returned" || outcome === "restored";
    await tx.insert(schema.event).values({ pokemonId: id, ts: now, kind: outcome === "restored" ? "milestone" : "trade", summary, importance: 4, trainerId: trainer.id, emotion: relieved ? "relieved" : "curious" });

    let bytesAwarded = 0;
    // The welcome bonus is once per trainer, and only for a file signed by a
    // known install. Keying it on the pokemon id would let anyone mint Bytes
    // by importing freshly generated files.
    if (outcome === "new" && verification === "verified") {
      const [paid] = await tx
        .select({ id: schema.ledger.id })
        .from(schema.ledger)
        .where(and(eq(schema.ledger.trainerId, trainer.id), eq(schema.ledger.reason, "milestone"), eq(schema.ledger.ref, "first_import")))
        .limit(1);
      if (!paid) {
        bytesAwarded = milestoneBonus("first_import");
        await adjustBytes(tx, trainer.id, bytesAwarded, "milestone", "first_import");
      }
    }

    const view = await pokemonView(row, trainer, now);
    return { view, outcome, verification, warnings, tradeNonce, bytesAwarded };
  });
}
