/**
 * Export and import of .cpkmn files, and the trade lock around them.
 *
 * Backup: pack the row, nothing changes. Trade: pack with trade.json, trim
 * the episodic log, mark the row in_transit; it cannot be cared for, made
 * active or exported again until a file with the same pokemonId comes back.
 *
 * Import: the file's pokemonId decides. Unknown id: a new arrival. Known
 * and in_transit: the original trainer importing cancels the trade (home);
 * another trainer importing confirms it (a same-install trade). Known and
 * anything else: refused, the pokemon is already here.
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
  type KeyFile,
  type KnownKeys,
  type Signer,
  type Trade,
  type Verification,
  type Warning,
} from "@gotcha/cpkmn";
import { DAY, milestoneBonus } from "@/lib/sim";
import { schema, type Db } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { reconcileActive } from "./party";
import { assertTouchable, freeBoxSlot, freeSlot, lockAll } from "./pokemon";
import { assetPackFor } from "./species";
import { adjustBytes } from "./trainers";
import { displayName, pokemonView, type PokemonView } from "./views";

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

  const pokemon = rowToPokemon(row);
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
  const bytes = await pack({ ...pokemon, memories: { ...pokemon.memories, episodic: trimEpisodic(pokemon.memories.episodic) }, trade }, packOptions);

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

export type ImportOutcome = "new" | "returned" | "received";

export interface ImportResult {
  view: PokemonView;
  outcome: ImportOutcome;
  verification: Verification;
  warnings: Warning[];
  /** The trade this import closed, if any. */
  tradeNonce: string | null;
  bytesAwarded: number;
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

    if (existing) {
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
      if (pokemon.trade || outcome === "received") {
        history.trades.push({ at: now, fromInstall: outcome === "received" ? c.installId : fromInstall, toInstall: c.installId, verified: verification === "verified" });
      }
    }
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

    const summary =
      outcome === "returned"
        ? `Came back home to ${trainer.displayName}`
        : outcome === "received"
          ? `Traded to ${trainer.displayName}`
          : `Arrived at ${trainer.displayName}'s from ${fromInstall} (${verification})`;
    await tx.insert(schema.event).values({ pokemonId: id, ts: now, kind: "trade", summary, importance: 4, trainerId: trainer.id, emotion: outcome === "returned" ? "relieved" : "curious" });

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
