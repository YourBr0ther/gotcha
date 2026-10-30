import { describe, expect, it } from "vitest";
import { pickAmbient, type AmbientCandidate } from "./candidates";

const pool: AmbientCandidate[] = [
  { species: "pidgey", baseScale: 0.7, flies: true, swims: false, walks: true },
  { species: "butterfree", baseScale: 0.6, flies: true, swims: false, walks: false },
  { species: "eevee", baseScale: 0.5, flies: false, swims: false, walks: true },
  { species: "rattata", baseScale: 0.4, flies: false, swims: true, walks: true },
  { species: "magikarp", baseScale: 1, flies: false, swims: true, walks: false },
];

describe("pickAmbient", () => {
  it("takes one flier and one grounded species, the same ones for the same seed", () => {
    const a = pickAmbient(pool, "meadow");
    const b = pickAmbient(pool, "meadow");
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a.map((p) => p.role).sort()).toEqual(["flier", "walker"]);
    expect(pool.find((c) => c.species === a[0].species)?.flies).toBe(true);
  });

  it("never picks the active species and copes with a pool without fliers", () => {
    const picks = pickAmbient(pool, "pond", ["eevee", "pidgey", "butterfree"]);
    expect(picks.map((p) => p.species).sort()).toEqual(["magikarp", "rattata"]);
    expect(picks.every((p) => p.role === "walker")).toBe(true);
    expect(pickAmbient([], "cave")).toEqual([]);
  });
});
