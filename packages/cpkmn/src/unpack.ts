import { readArchive } from "./archive";
import {
  ASSETS_PREFIX,
  CLAMPS,
  EPISODIC_ENTRY,
  JSON_MEMBERS,
  MEMBER_ORDER,
  RELATIONSHIPS_ENTRY,
  REQUIRED_ASSETS,
  REQUIRED_MEMBERS,
  SUMMARY_ENTRY,
  SUMMARY_MAX_CHARS,
  type JsonMemberKey,
} from "./constants";
import { CpkmnError, type Warning } from "./errors";
import { isAssetEntry, isPlainObject, parseMembers, type ParsedMembers } from "./members";
import { migrate } from "./migrate";
import { formatFailures, knownKeys as schemaKeys, validate, type SchemaDef } from "./schema";
import { checkSignature, type KnownKeys } from "./signing";
import {
  NEED_NAMES,
  type AssetFiles,
  type CpkmnPokemon,
  type EpisodicEvent,
  type Manifest,
  type Memories,
  type Verification,
} from "./types";

export interface UnpackOptions {
  /** keyId to base64 public key. Without it every signed file is "unverified". */
  knownKeys?: KnownKeys;
}

export interface UnpackResult {
  pokemon: CpkmnPokemon;
  manifest: Manifest;
  verification: Verification;
  warnings: Warning[];
}

/**
 * Reads a .cpkmn. Throws CpkmnError for corruption (bad zip, wrong mimetype,
 * hash mismatch, unlisted member, schema failure, unknown major); anything
 * else is a warning.
 *
 * Stasis is the caller's job: `pokemon.state.lastTickAt` comes back exactly
 * as written. The importer sets it to the import time before saving so the
 * time the file spent in transit does not decay the pokemon.
 */
export async function unpack(bytes: Uint8Array, options: UnpackOptions = {}): Promise<UnpackResult> {
  const archive = readArchive(bytes);
  const warnings = [...archive.warnings];
  const { manifest } = archive;

  const signature = await checkSignature(manifest, options.knownKeys);
  if (signature.verification === "unsigned") {
    warnings.push({ code: "unsigned", message: "file carries no signature" });
  } else if (signature.verification === "unverified") {
    warnings.push({ code: "signature_invalid", message: `signature by ${signature.keyId} not verified: ${signature.reason}` });
  }

  const migrated = migrate(parseMembers(archive.members), manifest.formatVersion);
  warnings.push(...migrated.warnings);
  const members = migrated.members;

  for (const name of REQUIRED_MEMBERS) {
    if (!(name in members)) throw new CpkmnError("missing_member", `${name} is missing`, name);
  }

  const extra: NonNullable<CpkmnPokemon["extra"]> = {};
  const take = <T>(key: JsonMemberKey, def: SchemaDef, clamp?: (value: Record<string, unknown>) => void): T => {
    const name = JSON_MEMBERS[key];
    const value = members[name];
    if (!isPlainObject(value)) throw new CpkmnError("bad_member", `${name} is not a JSON object`, name);
    clamp?.(value);
    assertValid(def, value, name);
    const { known, unknown } = split(value, schemaKeys(def));
    if (unknown) {
      extra[key] = unknown;
      warnings.push({ code: "unknown_keys", member: name, message: `${name} has keys this version does not know, preserved: ${Object.keys(unknown).join(", ")}` });
    }
    return known as T;
  };

  const pokemon: CpkmnPokemon = {
    identity: take("identity", "identity"),
    stats: take("stats", "stats", (stats) => clampStats(stats, warnings)),
    state: take("state", "state", (state) => clampNeeds(state, warnings)),
    personality: take("personality", "personality", (p) => clampDecay(p, warnings)),
    memories: readMemories(members, warnings),
    pokedex: take("pokedex", "pokedex"),
    inventory: take("inventory", "inventory"),
    history: take("history", "history"),
  };
  if (JSON_MEMBERS.trade in members) pokemon.trade = take("trade", "trade");

  const assets = readAssets(members, manifest, warnings);
  if (assets) pokemon.assets = assets;

  for (const name of Object.keys(members)) {
    if (!MEMBER_ORDER.includes(name) && !isAssetEntry(name)) {
      warnings.push({ code: "unknown_member", member: name, message: `${name} is a member this version does not know; it is not carried into the pokemon` });
    }
  }

  const { unknown: manifestExtra } = split(manifest as unknown as Record<string, unknown>, schemaKeys("manifest"));
  if (manifestExtra) extra.manifest = manifestExtra;
  if (Object.keys(extra).length > 0) pokemon.extra = extra;

  return { pokemon, manifest, verification: signature.verification, warnings };
}

function readMemories(members: ParsedMembers, warnings: Warning[]): Memories {
  const summary = members[SUMMARY_ENTRY];
  if (typeof summary !== "string") throw new CpkmnError("bad_member", `${SUMMARY_ENTRY} is not text`, SUMMARY_ENTRY);
  if (summary.length > SUMMARY_MAX_CHARS) {
    warnings.push({ code: "summary_long", member: SUMMARY_ENTRY, message: `summary is ${summary.length} characters, spec says under ${SUMMARY_MAX_CHARS}` });
  }

  const lines = members[EPISODIC_ENTRY];
  if (!Array.isArray(lines)) throw new CpkmnError("bad_member", `${EPISODIC_ENTRY} is not JSONL`, EPISODIC_ENTRY);
  const episodic: EpisodicEvent[] = [];
  lines.forEach((line, i) => {
    const failures = validate("episodicEvent", line);
    if (failures.length === 0) {
      episodic.push(line as EpisodicEvent);
    } else {
      warnings.push({
        code: "episodic_line_dropped",
        member: EPISODIC_ENTRY,
        path: `line ${i + 1}`,
        message: `${EPISODIC_ENTRY} line ${i + 1} dropped: ${formatFailures(failures)}`,
      });
    }
  });

  const relationships = members[RELATIONSHIPS_ENTRY];
  if (!isPlainObject(relationships)) throw new CpkmnError("bad_member", `${RELATIONSHIPS_ENTRY} is not a JSON object`, RELATIONSHIPS_ENTRY);
  assertValid("relationships", relationships, RELATIONSHIPS_ENTRY);

  return { summary, episodic, relationships: relationships as Memories["relationships"] };
}

function readAssets(members: ParsedMembers, manifest: Manifest, warnings: Warning[]): AssetFiles | undefined {
  const assets: AssetFiles = {};
  let any = false;
  for (const [name, value] of Object.entries(members)) {
    if (!isAssetEntry(name)) continue;
    if (!(value instanceof Uint8Array)) throw new CpkmnError("bad_member", `${name} is not bytes`, name);
    assets[name.slice(ASSETS_PREFIX.length)] = value;
    any = true;
  }
  if (manifest.assetMode === "embedded") {
    const missing = REQUIRED_ASSETS.filter((path) => !(path in assets));
    if (missing.length > 0) {
      warnings.push({ code: "asset_missing", message: `embedded file is missing assets: ${missing.join(", ")}` });
    }
  }
  return any ? assets : undefined;
}

function split(value: Record<string, unknown>, known: ReadonlySet<string>) {
  const kept: Record<string, unknown> = {};
  const unknown: Record<string, unknown> = {};
  let anyUnknown = false;
  for (const [key, v] of Object.entries(value)) {
    if (known.has(key)) kept[key] = v;
    else {
      unknown[key] = v;
      anyUnknown = true;
    }
  }
  return { known: kept, unknown: anyUnknown ? unknown : undefined };
}

function assertValid(def: SchemaDef, value: unknown, member: string): void {
  const failures = validate(def, value);
  if (failures.length > 0) {
    throw new CpkmnError("schema", `${member} fails the schema: ${formatFailures(failures)}`, member);
  }
}

function clampNumber(
  holder: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  member: string,
  path: string,
  warnings: Warning[],
): void {
  const value = holder[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const clamped = Math.min(max, Math.max(min, value));
  if (clamped === value) return;
  holder[key] = clamped;
  warnings.push({ code: "clamped", member, path, message: `${path} was ${value}, clamped to ${clamped}` });
}

function clampStats(stats: Record<string, unknown>, warnings: Warning[]): void {
  clampNumber(stats, "friendship", CLAMPS.friendship.min, CLAMPS.friendship.max, JSON_MEMBERS.stats, "/friendship", warnings);
}

function clampNeeds(state: Record<string, unknown>, warnings: Warning[]): void {
  const needs = state.needs;
  if (!isPlainObject(needs)) return;
  for (const need of NEED_NAMES) {
    clampNumber(needs, need, CLAMPS.need.min, CLAMPS.need.max, JSON_MEMBERS.state, `/needs/${need}`, warnings);
  }
}

function clampDecay(personality: Record<string, unknown>, warnings: Warning[]): void {
  const multipliers = personality.decayMultipliers;
  if (!isPlainObject(multipliers)) return;
  for (const key of Object.keys(multipliers)) {
    clampNumber(
      multipliers,
      key,
      CLAMPS.decayMultiplier.min,
      CLAMPS.decayMultiplier.max,
      JSON_MEMBERS.personality,
      `/decayMultipliers/${key}`,
      warnings,
    );
  }
}
