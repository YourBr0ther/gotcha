import { describe, expect, it } from "vitest";
import { SLEEPY_ENERGY } from "@/lib/sim";
import { buildMenu, localTime } from "./menu";
import { rulesReply, rulesTick } from "./rules";
import { BRAIN_ACTIVITIES, EMOTES } from "./types";
import { fakeContext, MIDNIGHT, NOON, SQUIRTLE_FACTS } from "./test/helpers";

describe("menu", () => {
  it("offers sleep only when tired or at night, swim only with water and a swimmer, and nothing but sleep when asleep", () => {
    const day = fakeContext({ now: NOON });
    expect(day.menu.activities).toEqual(["idle", "walk"]);
    const tired = fakeContext({ now: NOON, needs: { energy: SLEEPY_ENERGY - 1 } });
    expect(tired.menu.activities).toContain("sleep");
    const night = fakeContext({ now: MIDNIGHT });
    expect(night.menu.activities).toContain("sleep");
    const swimmer = fakeContext({ now: NOON, facts: SQUIRTLE_FACTS });
    expect(swimmer.menu.activities).toContain("swim");
    const dry = fakeContext({ now: NOON, facts: SQUIRTLE_FACTS, state: { location: { diorama: "cave" } } });
    expect(dry.menu.activities).not.toContain("swim");
    const asleep = fakeContext({ now: NOON, state: { asleep: true } });
    expect(asleep.menu.activities).toEqual(["sleep"]);
    expect(asleep.menu.emotes).toEqual(["sleepy"]);
  });

  it("local time follows the trainer's offset", () => {
    expect(localTime("2026-11-02T03:00:00.000Z", -300)).toMatchObject({ hour: 22, night: true, period: "night" });
    expect(localTime("2026-11-02T13:00:00.000Z", 60)).toMatchObject({ hour: 14, night: false, period: "afternoon" });
  });

  it("only lets a bored or neglected pokemon start misbehaving", () => {
    const ctx = fakeContext();
    expect(buildMenu(ctx.state, ctx.mood, ctx.facts, ctx.local).canMisbehave).toBe(false);
    const bored = fakeContext({ needs: { fun: 20 } });
    expect(bored.menu.canMisbehave).toBe(true);
  });
});

describe("rulesTick", () => {
  it("always picks from the menu and is stable for the same seed and minute", () => {
    for (let i = 0; i < 50; i++) {
      const ctx = fakeContext({ now: `2026-11-02T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`, needs: { fun: 100 - i, energy: 100 - i * 2 } });
      const plan = rulesTick(ctx);
      expect(ctx.menu.activities).toContain(plan.activity);
      expect(BRAIN_ACTIVITIES).toContain(plan.activity);
      if (plan.emote) expect(ctx.menu.emotes).toContain(plan.emote);
      expect(rulesTick(ctx)).toEqual(plan);
    }
  });

  it("sleeps when exhausted, paces when hungry, and stays asleep when asleep", () => {
    expect(rulesTick(fakeContext({ needs: { energy: 10 } })).activity).toBe("sleep");
    expect(rulesTick(fakeContext({ needs: { hunger: 10 } })).activity).toBe("walk");
    expect(rulesTick(fakeContext({ state: { asleep: true } }))).toMatchObject({ activity: "sleep", cry: false });
  });

  it("a mischievous pokemon sometimes acts out when bored; a gentle one never does", () => {
    let acted = 0;
    for (let i = 0; i < 60; i++) {
      const plan = rulesTick(fakeContext({ now: `2026-11-02T10:${String(i).padStart(2, "0")}:00.000Z`, needs: { fun: 15 }, personality: { traits: ["mischievous"] } }));
      if (plan.misbehaving) acted += 1;
      const gentle = rulesTick(fakeContext({ now: `2026-11-02T10:${String(i).padStart(2, "0")}:00.000Z`, needs: { fun: 15 }, personality: { traits: ["gentle"] } }));
      expect(gentle.misbehaving).toBeUndefined();
    }
    expect(acted).toBeGreaterThan(0);
    expect(acted).toBeLessThan(40);
  });
});

describe("rulesReply", () => {
  it("answers in the mood's voice with an emote from the menu", () => {
    const hungry = fakeContext({ needs: { hunger: 10 } });
    const reply = rulesReply(hungry);
    expect(reply.line.length).toBeLessThanOrEqual(80);
    expect(EMOTES).toContain(reply.emote);
    expect(hungry.menu.emotes).toContain(reply.emote);
    expect(rulesReply(fakeContext({ state: { asleep: true } })).cry).toBe(false);
  });
});
