import { describe, expect, it } from "vitest";
import { CpkmnError, FORMAT_VERSION, MIGRATIONS, migrate, parseVersion, trimEpisodic, type EpisodicEvent } from "../src";

describe("migrate", () => {
  const members = { "identity.json": { species: "pikachu" }, "memories/summary.md": "hi" };

  it("is the identity for the current version", () => {
    const result = migrate(members, FORMAT_VERSION);
    expect(result.members).toBe(members);
    expect(result.formatVersion).toBe(FORMAT_VERSION);
    expect(result.warnings).toEqual([]);
  });

  it("is the identity for an older patch or minor of the same major", () => {
    expect(migrate(members, "1.0.0").warnings).toEqual([]);
  });

  it("warns on a newer minor or patch", () => {
    expect(migrate(members, "1.9.0").warnings.map((w) => w.code)).toEqual(["newer_minor"]);
    expect(migrate(members, "1.0.9").warnings.map((w) => w.code)).toEqual(["newer_minor"]);
  });

  it("refuses a higher major", () => {
    expect(() => migrate(members, "2.0.0")).toThrow(CpkmnError);
    try {
      migrate(members, "2.0.0");
    } catch (error) {
      expect((error as CpkmnError).code).toBe("unsupported_version");
      expect((error as CpkmnError).message).toMatch(/update the app/);
    }
  });

  it("refuses a lower major with no migration registered", () => {
    expect(MIGRATIONS).toEqual([]);
    expect(() => migrate(members, "0.9.0")).toThrow(/no migration from cpkmn 0\.x/);
  });

  it("refuses a version that is not semver", () => {
    expect(() => migrate(members, "1.0")).toThrow(/not semver/);
    expect(parseVersion("3.2.1")).toEqual({ major: 3, minor: 2, patch: 1 });
  });
});

describe("trimEpisodic", () => {
  const event = (i: number, importance: EpisodicEvent["importance"]): EpisodicEvent => ({
    ts: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    kind: "other",
    summary: `event ${i}`,
    importance,
  });

  it("keeps the newest N lines plus anything important, in order", () => {
    const events = Array.from({ length: 12 }, (_, i) => event(i, i === 1 ? 3 : i === 4 ? 5 : 1));
    const kept = trimEpisodic(events, 5, 3);
    expect(kept.map((e) => e.summary)).toEqual(["event 1", "event 4", "event 7", "event 8", "event 9", "event 10", "event 11"]);
  });

  it("returns everything when the log is short", () => {
    const events = [event(0, 1), event(1, 1)];
    expect(trimEpisodic(events)).toEqual(events);
  });
});
