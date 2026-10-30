import { sha256Hex, toBase64, utf8Encode } from "./bytes";
import {
  ASSETS_PREFIX,
  EPISODIC_ENTRY,
  FORMAT_VERSION,
  JSON_MEMBERS,
  MANIFEST_ENTRY,
  MIMETYPE,
  MIMETYPE_ENTRY,
  RELATIONSHIPS_ENTRY,
  SUMMARY_ENTRY,
  type JsonMemberKey,
} from "./constants";
import { CpkmnError } from "./errors";
import { assertEntryName, encodeJson, encodeJsonl, encodeText, isPlainObject } from "./members";
import { formatFailures, validate, type SchemaDef } from "./schema";
import { signaturePayload, type Signer } from "./signing";
import type { AssetMode, CpkmnPokemon, Manifest } from "./types";
import { writeZip, type ZipWriteEntry } from "./zip";

export interface PackOptions {
  assetMode: AssetMode;
  /** Omit for an unsigned file. */
  signer?: Signer;
  generator: { name: string; version: string };
  /** Required in reference mode, where the importer resolves assets by this hash. */
  assetPack?: Manifest["assetPack"];
  /** Becomes manifest.exportedAt and the signature's signedAt. Defaults to now. */
  now?: Date | string;
  /** manifest.createdAt. Defaults to identity.hatchedAt. */
  createdAt?: string;
}

/**
 * Writes a .cpkmn. Every member is validated against the schema first, so a
 * file this produces always opens. pack does not trim episodic memories; the
 * exporter calls trimEpisodic before packing if it wants the spec's 500-line
 * cut.
 */
export async function pack(pokemon: CpkmnPokemon, options: PackOptions): Promise<Uint8Array> {
  if (options.assetMode !== "embedded" && options.assetMode !== "reference") {
    throw new CpkmnError("bad_input", `assetMode must be "embedded" or "reference", got ${JSON.stringify(options.assetMode)}`);
  }
  if (options.assetMode === "reference" && !options.assetPack) {
    throw new CpkmnError("bad_input", "reference mode needs options.assetPack so the importer can match its Cobblemon pack");
  }
  if (options.assetMode === "embedded" && !pokemon.assets) {
    throw new CpkmnError("bad_input", "embedded mode needs pokemon.assets");
  }
  if (!options.generator?.name || !options.generator?.version) {
    throw new CpkmnError("bad_input", "options.generator needs a name and a version");
  }

  const exportedAt = toIso(options.now ?? new Date());
  const extra = pokemon.extra ?? {};

  const members: ZipWriteEntry[] = [];
  const jsonMember = (key: JsonMemberKey, def: SchemaDef, value: unknown) => {
    const merged = withExtras(value, extra[key], JSON_MEMBERS[key]);
    assertValid(def, merged, JSON_MEMBERS[key]);
    members.push({ name: JSON_MEMBERS[key], data: encodeJson(merged), stored: false });
  };

  jsonMember("identity", "identity", pokemon.identity);
  jsonMember("stats", "stats", pokemon.stats);
  jsonMember("state", "state", pokemon.state);
  jsonMember("personality", "personality", pokemon.personality);

  const memories = pokemon.memories;
  if (!memories || typeof memories.summary !== "string" || !Array.isArray(memories.episodic) || !isPlainObject(memories.relationships)) {
    throw new CpkmnError("bad_input", "pokemon.memories needs summary (string), episodic (array) and relationships (object)");
  }
  members.push({ name: SUMMARY_ENTRY, data: encodeText(memories.summary), stored: false });
  memories.episodic.forEach((event, i) => assertValid("episodicEvent", event, `${EPISODIC_ENTRY} line ${i + 1}`));
  members.push({ name: EPISODIC_ENTRY, data: encodeJsonl(memories.episodic), stored: false });
  assertValid("relationships", memories.relationships, RELATIONSHIPS_ENTRY);
  members.push({ name: RELATIONSHIPS_ENTRY, data: encodeJson(memories.relationships), stored: false });

  jsonMember("pokedex", "pokedex", pokemon.pokedex);
  jsonMember("inventory", "inventory", pokemon.inventory);
  jsonMember("history", "history", pokemon.history);
  if (pokemon.trade) jsonMember("trade", "trade", pokemon.trade);

  if (options.assetMode === "embedded") {
    for (const path of Object.keys(pokemon.assets!).sort()) {
      const name = ASSETS_PREFIX + path;
      assertEntryName(name);
      const data = pokemon.assets![path];
      if (!(data instanceof Uint8Array)) throw new CpkmnError("bad_input", `asset ${path} is not a Uint8Array`, name);
      members.push({ name, data, stored: true });
    }
  }

  const contents: Manifest["contents"] = {};
  for (const member of members) contents[member.name] = { sha256: sha256Hex(member.data), bytes: member.data.length };

  const manifest: Manifest = {
    format: "cpkmn",
    formatVersion: FORMAT_VERSION,
    generator: { name: options.generator.name, version: options.generator.version },
    pokemonId: pokemon.identity.pokemonId,
    createdAt: options.createdAt ?? pokemon.identity.hatchedAt,
    exportedAt,
    assetMode: options.assetMode,
    ...(options.assetPack ? { assetPack: options.assetPack } : {}),
    contents,
  };
  if (options.signer) {
    const value = toBase64(await options.signer.sign(signaturePayload(manifest)));
    manifest.signature = { alg: "ed25519", keyId: options.signer.keyId, signedAt: exportedAt, value };
  }
  const manifestOut = withExtras(manifest, extra.manifest, MANIFEST_ENTRY);
  assertValid("manifest", manifestOut, MANIFEST_ENTRY);

  const entries: ZipWriteEntry[] = [
    { name: MIMETYPE_ENTRY, data: utf8Encode(MIMETYPE), stored: true },
    { name: MANIFEST_ENTRY, data: encodeJson(manifestOut), stored: false },
    ...members,
  ];
  return writeZip(entries, new Date(exportedAt));
}

function toIso(value: Date | string): string {
  if (typeof value === "string") {
    if (Number.isNaN(Date.parse(value))) throw new CpkmnError("bad_input", `options.now "${value}" is not a date`);
    return value;
  }
  if (Number.isNaN(value.getTime())) throw new CpkmnError("bad_input", "options.now is an invalid Date");
  return value.toISOString();
}

/** Known fields first, then the preserved unknown keys that do not collide. */
function withExtras(value: unknown, extras: Record<string, unknown> | undefined, member: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new CpkmnError("bad_input", `${member} must be an object`, member);
  const out: Record<string, unknown> = { ...value };
  for (const [key, v] of Object.entries(extras ?? {})) if (!(key in out)) out[key] = v;
  return out;
}

function assertValid(def: SchemaDef, value: unknown, member: string): void {
  const failures = validate(def, value);
  if (failures.length > 0) {
    throw new CpkmnError("bad_input", `${member} fails the schema: ${formatFailures(failures)}`, member);
  }
}
