/**
 * Members are the entries of the archive other than mimetype and
 * manifest.json. Raw members are bytes; parsed members are what those bytes
 * mean: JSON for `*.json`, a string for `memories/summary.md`, an array of
 * objects for `memories/episodic.jsonl`, and untouched bytes under `assets/`.
 */
import { utf8Decode, utf8Encode } from "./bytes";
import { ASSETS_PREFIX, EPISODIC_ENTRY, SUMMARY_ENTRY } from "./constants";
import { CpkmnError } from "./errors";

export type RawMembers = Record<string, Uint8Array>;
export type ParsedMembers = Record<string, unknown>;

export function isAssetEntry(name: string): boolean {
  return name.startsWith(ASSETS_PREFIX);
}

/** Forward slashes, no leading slash, no `..`, no empty segment, no control characters. */
export function assertEntryName(name: string): void {
  const bad =
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.endsWith("/") ||
    name.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    /[\u0000-\u001f]/.test(name);
  if (bad) throw new CpkmnError("bad_entry_name", `entry name "${name}" is not allowed`, name);
}

/** Pretty JSON with a trailing newline, what every JSON member holds on disk. */
export function encodeJson(value: unknown): Uint8Array {
  return utf8Encode(JSON.stringify(value, null, 2) + "\n");
}

export function encodeJsonl(lines: readonly unknown[]): Uint8Array {
  return utf8Encode(lines.map((line) => JSON.stringify(line) + "\n").join(""));
}

export function encodeText(text: string): Uint8Array {
  return utf8Encode(text);
}

function parseJson(name: string, bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8Decode(bytes));
  } catch (error) {
    throw new CpkmnError("bad_member", `${name} is not valid JSON: ${(error as Error).message}`, name);
  }
}

function parseJsonl(name: string, bytes: Uint8Array): unknown[] {
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch (error) {
    throw new CpkmnError("bad_member", `${name} is not valid UTF-8: ${(error as Error).message}`, name);
  }
  const out: unknown[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch (error) {
      throw new CpkmnError("bad_member", `${name} line ${i + 1} is not valid JSON: ${(error as Error).message}`, name);
    }
  }
  return out;
}

export function parseMember(name: string, bytes: Uint8Array): unknown {
  if (isAssetEntry(name)) return bytes;
  if (name === SUMMARY_ENTRY) {
    try {
      return utf8Decode(bytes);
    } catch (error) {
      throw new CpkmnError("bad_member", `${name} is not valid UTF-8: ${(error as Error).message}`, name);
    }
  }
  if (name === EPISODIC_ENTRY) return parseJsonl(name, bytes);
  if (name.endsWith(".json")) return parseJson(name, bytes);
  // A member we do not know (a newer minor's addition). Keep the bytes.
  return bytes;
}

export function parseMembers(raw: RawMembers): ParsedMembers {
  const parsed: ParsedMembers = {};
  for (const [name, bytes] of Object.entries(raw)) parsed[name] = parseMember(name, bytes);
  return parsed;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}
