import { describe, expect, it } from "vitest";
import { careAction, CARE_ACTIONS } from "./care";
import { CARE, CARE_EXPERIENCE, CARE_FRIENDSHIP, CARE_MISTAKE_FRIENDSHIP, MILESTONE_BYTES, NEED_MAX, STORE_ITEMS } from "./constants";
import { freshState } from "./defaults";
import { storeItem } from "./store";
import { expectPure } from "./testing";

const NOW = "2026-11-01T12:00:00.000Z";
const oran = storeItem("oran_berry")!;
const curry = storeItem("curry")!;
const toy = storeItem("ball_toy")!;
const asleep = (needs = {}) => ({ ...freshState(NOW, { energy: 20, ...needs }), asleep: true, sleepStartedAt: NOW });
const sick = (needs = {}) => ({ ...freshState(NOW, needs), sickness: { kind: "cold", since: NOW, severity: 1 as const } });

describe("careAction", () => {
  it("does not mutate its inputs for any action", () => {
    const fixtures: Record<(typeof CARE_ACTIONS)[number], () => ReturnType<typeof freshState>> = {
      feed: () => freshState(NOW, { hunger: 50 }),
      play: () => asleep(),
      groom: () => freshState(NOW, { hygiene: 10 }),
      rest: () => freshState(NOW, { energy: 30 }),
      wake: () => asleep(),
      medicine: () => sick(),
      discipline: () => ({ ...freshState(NOW), flags: { misbehaving: true } }),
      pet: () => freshState(NOW),
    };
    for (const action of CARE_ACTIONS) {
      const item = action === "feed" ? oran : action === "play" ? toy : null;
      expectPure({ state: fixtures[action](), item }, (i) => careAction(i.state, action, i.item, NOW));
    }
  });

  it("feeds by the item's fill and leaves lastTickAt alone", () => {
    const r = careAction(freshState(NOW, { hunger: 50, affection: 50 }), "feed", oran, NOW);
    expect(r.state.needs.hunger).toBe(50 + STORE_ITEMS.oran_berry.fill.hunger);
    expect(r.state.needs.fun).toBe(NEED_MAX);
    expect(r.state.needs.affection).toBe(50 + CARE.feed.affection);
    expect(r.state.lastTickAt).toBe(NOW);
    expect(r).toMatchObject({ mistake: false, refused: false, bytes: 0, experience: CARE_EXPERIENCE.feed, friendship: CARE_FRIENDSHIP.feed });
  });

  it("counts over-feeding as a care mistake that makes a mess", () => {
    const r = careAction(freshState(NOW, { hunger: CARE.feed.overfeedThreshold }), "feed", oran, NOW);
    expect(r.mistake).toBe(true);
    expect(r.state.careMistakes).toBe(1);
    expect(r.state.needs.hygiene).toBe(NEED_MAX - CARE.feed.overfeedHygieneDrop);
    expect(r.state.lastMessAt).toBe(NOW);
    expect(r.friendship).toBe(CARE_FRIENDSHIP.feed + CARE_MISTAKE_FRIENDSHIP);
    expect(r.events.map((e) => e.kind)).toContain("care_mistake");
  });

  it("refuses food while asleep and throws without a food item", () => {
    const r = careAction(asleep(), "feed", oran, NOW);
    expect(r.refused).toBe(true);
    expect(r.state.needs.hunger).toBe(NEED_MAX);
    expect(() => careAction(freshState(NOW), "feed", null, NOW)).toThrow();
    expect(() => careAction(freshState(NOW), "feed", storeItem("potion")!, NOW)).toThrow();
  });

  it("pays the recovery milestone when a need goes from under 20 to full", () => {
    const r = careAction(freshState(NOW, { hunger: 10 }), "feed", curry, NOW);
    expect(r.state.needs.hunger).toBe(NEED_MAX);
    expect(r.bytes).toBe(MILESTONE_BYTES.recovery);
    expect(r.events.find((e) => e.kind === "milestone")).toMatchObject({ need: "hunger" });
  });

  it("play raises fun and costs energy, hunger and hygiene", () => {
    const r = careAction(freshState(NOW, { fun: 20 }), "play", null, NOW);
    expect(r.state.needs.fun).toBe(20 + CARE.play.fun);
    expect(r.state.needs.energy).toBe(NEED_MAX - CARE.play.energyCost);
    expect(r.state.needs.hunger).toBe(NEED_MAX - CARE.play.hungerCost);
    expect(r.state.needs.hygiene).toBe(NEED_MAX - CARE.play.hygieneCost);
    expect(r.modifier).toBeUndefined();
  });

  it("play with a toy returns its decay modifier for the caller to store", () => {
    const r = careAction(freshState(NOW, { fun: 0 }), "play", toy, NOW);
    const m = STORE_ITEMS.ball_toy.modifier;
    expect(r.modifier).toEqual({ need: m.need, factor: m.factor, until: new Date(Date.parse(NOW) + m.duration).toISOString(), source: "ball_toy" });
    expect(r.state.needs.fun).toBe(CARE.play.fun + STORE_ITEMS.ball_toy.fill.fun);
  });

  it("play while tired only half counts, and play while asleep wakes it as a mistake", () => {
    const tired = careAction(freshState(NOW, { fun: 0, energy: CARE.play.tiredEnergy - 1 }), "play", null, NOW);
    expect(tired.state.needs.fun).toBe(CARE.play.fun / 2);
    const woken = careAction(asleep({ fun: 0 }), "play", null, NOW);
    expect(woken.mistake).toBe(true);
    expect(woken.state.asleep).toBe(false);
  });

  it("groom fills hygiene", () => {
    expect(careAction(freshState(NOW, { hygiene: 3 }), "groom", null, NOW).state.needs.hygiene).toBe(NEED_MAX);
    expect(careAction(asleep({ hygiene: 3 }), "groom", null, NOW).refused).toBe(true);
  });

  it("rest puts the pokemon to bed unless it is not tired", () => {
    const r = careAction(freshState(NOW, { energy: CARE.rest.refuseEnergy - 1 }), "rest", null, NOW);
    expect(r.state).toMatchObject({ asleep: true, sleepStartedAt: NOW });
    expect(careAction(freshState(NOW, { energy: CARE.rest.refuseEnergy }), "rest", null, NOW).refused).toBe(true);
    expect(careAction(asleep(), "rest", null, NOW).refused).toBe(true);
  });

  it("waking a sleeper early is a care mistake; waking a rested one is not", () => {
    const early = careAction(asleep({ energy: CARE.wake.safeEnergy - 1 }), "wake", null, NOW);
    expect(early.mistake).toBe(true);
    expect(early.state.asleep).toBe(false);
    expect(early.state.needs.affection).toBe(NEED_MAX - CARE.wake.affectionPenalty);
    const rested = careAction(asleep({ energy: CARE.wake.safeEnergy }), "wake", null, NOW);
    expect(rested.mistake).toBe(false);
    expect(careAction(freshState(NOW), "wake", null, NOW).refused).toBe(true);
  });

  it("medicine clears sickness, and is a mistake when healthy", () => {
    const cured = careAction(sick({ health: 20 }), "medicine", null, NOW);
    expect(cured.state.sickness).toBeNull();
    expect(cured.state.needs.health).toBe(20 + CARE.medicine.health);
    expect(cured.mistake).toBe(false);
    const withItem = careAction(sick({ health: 20 }), "medicine", storeItem("medicine")!, NOW);
    expect(withItem.state.needs.health).toBe(20 + CARE.medicine.health + STORE_ITEMS.medicine.fill.health);
    const wasted = careAction(freshState(NOW), "medicine", null, NOW);
    expect(wasted.mistake).toBe(true);
    expect(wasted.state.needs.affection).toBe(NEED_MAX - CARE.medicine.unneededAffectionPenalty);
  });

  it("discipline is right when misbehaving and a mistake otherwise", () => {
    const fair = careAction({ ...freshState(NOW), flags: { misbehaving: true } }, "discipline", null, NOW);
    expect(fair.state.flags?.misbehaving).toBe(false);
    expect(fair.mistake).toBe(false);
    expect(fair.state.needs.affection).toBe(NEED_MAX - CARE.discipline.affectionCost);
    const unjust = careAction(freshState(NOW), "discipline", null, NOW);
    expect(unjust.mistake).toBe(true);
    expect(unjust.state.needs.affection).toBe(NEED_MAX - CARE.discipline.unjustAffectionPenalty);
  });

  it("petting raises affection and a little fun", () => {
    const r = careAction(freshState(NOW, { affection: 0, fun: 0 }), "pet", null, NOW);
    expect(r.state.needs.affection).toBe(CARE.pet.affection);
    expect(r.state.needs.fun).toBe(CARE.pet.fun);
    expect(careAction(asleep(), "pet", null, NOW).refused).toBe(true);
  });
});
