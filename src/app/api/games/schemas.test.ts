import { describe, expect, it } from "vitest";
import { GAMES } from "@/app/games/registry";
import { MANIFESTS } from "@/games/manifests";
import { ResultBody, StartBody } from "./_lib/schemas";

describe("games route bodies", () => {
  it("accepts the shapes the client sends", () => {
    expect(StartBody.parse({ gameId: "berry-catch" })).toEqual({ gameId: "berry-catch" });
    expect(ResultBody.parse({ token: "a.b", gameId: "berry-catch", score: 9, maxScore: 12, durationMs: 60000 })).toEqual({
      token: "a.b",
      gameId: "berry-catch",
      score: 9,
      maxScore: 12,
      durationMs: 60000,
      perfect: false,
    });
  });

  it("rejects the wrong types before the service sees them", () => {
    expect(StartBody.safeParse({ gameId: "Berry Catch" }).success).toBe(false);
    expect(ResultBody.safeParse({ token: "", gameId: "berry-catch", score: 1, maxScore: 1, durationMs: 1 }).success).toBe(false);
    expect(ResultBody.safeParse({ token: "a.b", gameId: "berry-catch", score: -1, maxScore: 1, durationMs: 1 }).success).toBe(false);
    expect(ResultBody.safeParse({ token: "a.b", gameId: "berry-catch", score: 1, maxScore: 0, durationMs: 1 }).success).toBe(false);
    expect(ResultBody.safeParse({ token: "a.b", gameId: "berry-catch", score: 1, maxScore: 1, durationMs: 1.5 }).success).toBe(false);
    expect(ResultBody.safeParse({ token: "a.b", gameId: "berry-catch", score: "1", maxScore: 1, durationMs: 1 }).success).toBe(false);
  });

  it("lists every manifest on the Games page with a route and an id the schema accepts", () => {
    expect(GAMES.map((g) => g.id)).toEqual(MANIFESTS.map((m) => m.id));
    for (const g of GAMES) {
      expect(g.href).toBe(`/games/${g.id}`);
      expect(StartBody.safeParse({ gameId: g.id }).success).toBe(true);
    }
    for (const m of MANIFESTS) {
      expect(m.durationMs.min).toBeLessThan(m.durationMs.max);
      expect(m.seconds * 1000).toBeLessThanOrEqual(m.durationMs.max);
      expect(m.seconds).toBeLessThanOrEqual(90);
    }
  });
});
