/**
 * Route plumbing that needs no database: error shapes, auth fallbacks, the
 * rollover token and the key file. The services carry the database tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identityFromHeaders } from "@/lib/auth";
import { errorResponse } from "./_lib/handler";
import { ServiceError } from "@/lib/services/errors";
import { GET as health } from "./health/route";
import { POST as rolloverRoute } from "./internal/rollover/route";
import { GET as keys } from "../.well-known/cpkmn-keys.json/route";

describe("routes", () => {
  it("health answers without touching anything", async () => {
    const res = await health(new Request("http://x/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("maps service errors to { error, code } with their status", async () => {
    const res = errorResponse(new ServiceError("in_transit", "out for trade"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "out for trade", code: "in_transit" });
    expect(errorResponse(new Error("boom")).status).toBe(500);
  });

  it("the key file lists this install's public key when a signing key is configured", async () => {
    const res = await keys();
    const body = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(body.keys)).toBe(true);
  });

  describe("rollover token", () => {
    const saved = process.env.ROLLOVER_TOKEN;
    beforeEach(() => {
      process.env.ROLLOVER_TOKEN = "secret";
    });
    afterEach(() => {
      process.env.ROLLOVER_TOKEN = saved;
    });

    it("rejects a missing or wrong bearer token", async () => {
      const none = await rolloverRoute(new Request("http://x/api/internal/rollover", { method: "POST" }));
      expect(none.status).toBe(401);
      const wrong = await rolloverRoute(new Request("http://x/api/internal/rollover", { method: "POST", headers: { authorization: "Bearer nope" } }));
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toMatchObject({ code: "unauthenticated" });
    });
  });

  describe("identity", () => {
    it("prefers Remote-User and falls back to GOTCHA_DEV_USER outside production", () => {
      const headers = new Headers({ "Remote-User": "eli", "Remote-Name": "Eli V" });
      expect(identityFromHeaders(headers, { NODE_ENV: "production" })).toEqual({ username: "eli", displayName: "Eli V" });
      expect(identityFromHeaders(new Headers(), { NODE_ENV: "development", GOTCHA_DEV_USER: "tester" })).toEqual({ username: "tester" });
      expect(identityFromHeaders(new Headers(), { NODE_ENV: "production", GOTCHA_DEV_USER: "tester" })).toBeNull();
      expect(identityFromHeaders(new Headers(), { NODE_ENV: "development" })).toBeNull();
    });
  });
});
