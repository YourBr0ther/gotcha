import { describe, expect, it } from "vitest";
import { type AmbientCandidate, dayKey, pickCast, roleOf } from "./candidates";

const pool: AmbientCandidate[] = [
  { species: "pidgey", baseScale: 0.7, flies: true, swims: false, walks: true },
  { species: "butterfree", baseScale: 0.6, flies: true, swims: false, walks: false },
  { species: "zubat", baseScale: 0.5, flies: true, swims: false, walks: false },
  { species: "eevee", baseScale: 0.5, flies: false, swims: false, walks: true },
  { species: "rattata", baseScale: 0.4, flies: false, swims: true, walks: true },
  { species: "sentret", baseScale: 0.5, flies: false, swims: true, walks: true },
  { species: "magikarp", baseScale: 1, flies: false, swims: true, walks: false },
  { species: "goldeen", baseScale: 0.8, flies: false, swims: true, walks: false },
];

describe("pickCast", () => {
  it("draws the same cast for the same seed and a different one for another day", () => {
    const a = pickCast(pool, "meadow:2026-10-31");
    expect(pickCast(pool, "meadow:2026-10-31")).toEqual(a);
    expect(a).toHaveLength(6);
    const b = pickCast(pool, "meadow:2026-11-01");
    expect(b.map((p) => p.species)).not.toEqual(a.map((p) => p.species));
  });

  it("keeps at most two fliers so the ground is not empty", () => {
    const cast = pickCast(pool, "forest:2026-10-31");
    expect(cast.filter((p) => p.role === "flier").length).toBeLessThanOrEqual(2);
    expect(cast.filter((p) => p.role !== "flier").length).toBeGreaterThanOrEqual(4);
  });

  it("never casts the active species, and leaves swim-only species out of a dry scene", () => {
    const cast = pickCast(pool, "cave:2026-10-31", ["eevee"], false);
    const names = cast.map((p) => p.species);
    expect(names).not.toContain("eevee");
    expect(names).not.toContain("magikarp");
    expect(names).not.toContain("goldeen");
    expect(cast.every((p) => p.role !== "swimmer")).toBe(true);
  });

  it("fills a thin pool with whatever is left and copes with nothing", () => {
    const fliers = pool.filter((c) => c.flies);
    const cast = pickCast(fliers, "sky:2026-10-31");
    expect(cast).toHaveLength(3);
    expect(cast.every((p) => p.role === "flier")).toBe(true);
    expect(pickCast([], "cave:2026-10-31")).toEqual([]);
  });

  it("names the role by how the species moves", () => {
    expect(roleOf(pool[0])).toBe("flier");
    expect(roleOf(pool[3])).toBe("walker");
    expect(roleOf(pool[6])).toBe("swimmer");
  });
});

describe("dayKey", () => {
  it("is the local calendar date", () => {
    expect(dayKey(new Date(2026, 9, 31, 23, 59))).toBe("2026-10-31");
    expect(dayKey(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});
