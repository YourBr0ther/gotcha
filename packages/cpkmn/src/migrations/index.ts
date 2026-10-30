/**
 * Major-version migrations. Each one lifts the parsed members of a file
 * written at major `from` to the shape of major `from + 1`. unpack runs them
 * in order after the hashes are checked and before the current schema is
 * applied, so a migration sees the old shape and must produce the new one.
 *
 * 1.0.0 is the first version, so the list is empty. Adding a major means:
 * append `{ from: 1, run }` here, bump FORMAT_VERSION, and write the note in
 * docs/cpkmn-format.md under Versioning.
 */
import type { ParsedMembers } from "../members";

export interface Migration {
  /** Major version this migration reads. It writes major `from + 1`. */
  from: number;
  run(members: ParsedMembers): ParsedMembers;
}

export const MIGRATIONS: readonly Migration[] = [];
