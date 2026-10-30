/**
 * The part of reading a .cpkmn that unpack and verify share: open the zip,
 * confirm the mimetype, read and validate the manifest, refuse a major we do
 * not know, then check every hash before any member is parsed.
 */
import { bytesEqual, sha256Hex, utf8Decode, utf8Encode } from "./bytes";
import { FORMAT_VERSION, MANIFEST_ENTRY, MIMETYPE, MIMETYPE_ENTRY } from "./constants";
import { CpkmnError, type Warning } from "./errors";
import { assertEntryName, isAssetEntry, type RawMembers } from "./members";
import { parseVersion } from "./migrate";
import { formatFailures, validate } from "./schema";
import type { Manifest } from "./types";
import { METHOD_DEFLATE, METHOD_STORED, readZip, type ZipEntryInfo } from "./zip";

export interface Archive {
  manifest: Manifest;
  /** Every entry listed in manifest.contents, hashes already checked. */
  members: RawMembers;
  entries: ZipEntryInfo[];
  warnings: Warning[];
}

export function readArchive(bytes: Uint8Array): Archive {
  const { entries, files } = readZip(bytes);
  const warnings: Warning[] = [];

  const mimetype = files[MIMETYPE_ENTRY];
  if (!mimetype || !bytesEqual(mimetype, utf8Encode(MIMETYPE))) {
    throw new CpkmnError("not_cpkmn", `no ${MIMETYPE_ENTRY} entry holding ${MIMETYPE}; this is not a .cpkmn file`);
  }
  if (entries[0]?.name !== MIMETYPE_ENTRY) {
    warnings.push({ code: "entry_order", message: `${MIMETYPE_ENTRY} is not the first entry, so the file has no magic` });
  }
  if (entries[1]?.name !== MANIFEST_ENTRY) {
    warnings.push({ code: "entry_order", message: `${MANIFEST_ENTRY} is not the second entry` });
  }

  const manifest = readManifest(files[MANIFEST_ENTRY]);

  const members: RawMembers = {};
  for (const [name, expected] of Object.entries(manifest.contents)) {
    assertEntryName(name);
    const data = files[name];
    if (!data) throw new CpkmnError("missing_member", `${name} is listed in the manifest but missing from the archive`, name);
    if (data.length !== expected.bytes) {
      throw new CpkmnError(
        "hash_mismatch",
        `${name} is ${data.length} bytes, manifest says ${expected.bytes}`,
        name,
      );
    }
    const actual = sha256Hex(data);
    if (actual !== expected.sha256) {
      throw new CpkmnError("hash_mismatch", `${name} sha256 ${actual} does not match manifest ${expected.sha256}`, name);
    }
    members[name] = data;
  }

  const misCompressed: string[] = [];
  for (const entry of entries) {
    if (entry.name === MIMETYPE_ENTRY || entry.name === MANIFEST_ENTRY) continue;
    if (!(entry.name in members)) {
      throw new CpkmnError("unlisted_member", `${entry.name} is in the archive but not in the manifest`, entry.name);
    }
    const expected = isAssetEntry(entry.name) ? METHOD_STORED : METHOD_DEFLATE;
    if (entry.compression !== expected) misCompressed.push(entry.name);
  }
  if (entries[0]?.name === MIMETYPE_ENTRY && entries[0].compression !== METHOD_STORED) misCompressed.unshift(MIMETYPE_ENTRY);
  const manifestEntry = entries.find((e) => e.name === MANIFEST_ENTRY);
  if (manifestEntry && manifestEntry.compression !== METHOD_DEFLATE) misCompressed.push(MANIFEST_ENTRY);
  if (misCompressed.length > 0) {
    warnings.push({
      code: "compression",
      message: `entries not compressed the way the spec says (mimetype and assets stored, the rest deflated): ${misCompressed.join(", ")}`,
    });
  }

  return { manifest, members, entries, warnings };
}

function readManifest(bytes: Uint8Array | undefined): Manifest {
  if (!bytes) throw new CpkmnError("bad_manifest", `${MANIFEST_ENTRY} is missing`, MANIFEST_ENTRY);
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(bytes));
  } catch (error) {
    throw new CpkmnError("bad_manifest", `${MANIFEST_ENTRY} is not valid JSON: ${(error as Error).message}`, MANIFEST_ENTRY);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CpkmnError("bad_manifest", `${MANIFEST_ENTRY} is not an object`, MANIFEST_ENTRY);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.format !== "cpkmn") {
    throw new CpkmnError("not_cpkmn", `${MANIFEST_ENTRY} format is ${JSON.stringify(candidate.format)}, not "cpkmn"`, MANIFEST_ENTRY);
  }
  // Version before shape: a future major may change the manifest, and the
  // message should say "too new", not "invalid".
  if (typeof candidate.formatVersion !== "string") {
    throw new CpkmnError("bad_manifest", `${MANIFEST_ENTRY} has no formatVersion`, MANIFEST_ENTRY);
  }
  const version = parseVersion(candidate.formatVersion);
  if (version.major > parseVersion(FORMAT_VERSION).major) {
    throw new CpkmnError(
      "unsupported_version",
      `this file is cpkmn ${candidate.formatVersion} and this reader understands up to ${FORMAT_VERSION}; update the app to import it`,
    );
  }
  const failures = validate("manifest", candidate);
  if (failures.length > 0) {
    throw new CpkmnError("bad_manifest", `${MANIFEST_ENTRY} fails the schema: ${formatFailures(failures)}`, MANIFEST_ENTRY);
  }
  return candidate as unknown as Manifest;
}
