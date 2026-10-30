export type CpkmnErrorCode =
  | "not_cpkmn"
  | "bad_zip"
  | "bad_entry_name"
  | "bad_manifest"
  | "unsupported_version"
  | "no_migration"
  | "missing_member"
  | "unlisted_member"
  | "hash_mismatch"
  | "bad_member"
  | "schema"
  | "bad_input";

/**
 * Thrown for anything that makes the file unusable: not a .cpkmn, a hash
 * that does not match, a member that fails the schema, a version we cannot
 * read. Everything short of that is a warning on the unpack result.
 */
export class CpkmnError extends Error {
  readonly code: CpkmnErrorCode;
  readonly member?: string;

  constructor(code: CpkmnErrorCode, message: string, member?: string) {
    super(message);
    this.name = "CpkmnError";
    this.code = code;
    this.member = member;
  }
}

export interface Warning {
  code:
    | "clamped"
    | "unsigned"
    | "signature_invalid"
    | "unknown_keys"
    | "unknown_member"
    | "entry_order"
    | "compression"
    | "newer_minor"
    | "migrated"
    | "episodic_line_dropped"
    | "asset_missing"
    | "summary_long";
  message: string;
  member?: string;
  path?: string;
}
