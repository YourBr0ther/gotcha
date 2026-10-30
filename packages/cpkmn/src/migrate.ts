import { FORMAT_VERSION } from "./constants";
import { CpkmnError, type Warning } from "./errors";
import type { ParsedMembers } from "./members";
import { MIGRATIONS } from "./migrations";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): SemVer {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new CpkmnError("bad_manifest", `formatVersion "${version}" is not semver`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export interface MigrateResult {
  members: ParsedMembers;
  /** The version the members now conform to. */
  formatVersion: string;
  warnings: Warning[];
}

/**
 * Lifts members written at `fromVersion` to FORMAT_VERSION. Same major is an
 * identity migration (minor and patch changes are additive, unknown keys are
 * preserved elsewhere). A higher major is refused. A lower major walks the
 * MIGRATIONS list one major at a time.
 */
export function migrate(members: ParsedMembers, fromVersion: string): MigrateResult {
  const from = parseVersion(fromVersion);
  const current = parseVersion(FORMAT_VERSION);
  const warnings: Warning[] = [];

  if (from.major > current.major) {
    throw new CpkmnError(
      "unsupported_version",
      `this file is cpkmn ${fromVersion} and this reader understands up to ${FORMAT_VERSION}; update the app to import it`,
    );
  }

  if (from.major === current.major) {
    if (from.minor > current.minor || (from.minor === current.minor && from.patch > current.patch)) {
      warnings.push({
        code: "newer_minor",
        message: `file is cpkmn ${fromVersion}, newer than ${FORMAT_VERSION}; fields this reader does not know are preserved but not used`,
      });
    }
    return { members, formatVersion: FORMAT_VERSION, warnings };
  }

  let out = members;
  for (let major = from.major; major < current.major; major++) {
    const step = MIGRATIONS.find((m) => m.from === major);
    if (!step) {
      throw new CpkmnError("no_migration", `no migration from cpkmn ${major}.x to ${major + 1}.x`);
    }
    out = step.run(out);
    warnings.push({ code: "migrated", message: `migrated from cpkmn ${major}.x to ${major + 1}.x` });
  }
  return { members: out, formatVersion: FORMAT_VERSION, warnings };
}
