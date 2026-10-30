/**
 * The rules brain. Picks an activity and an emote from the menu using the
 * needs, the time and a seeded generator, so a pokemon with no model still
 * sleeps when tired, wanders when bored and sulks when hungry. Every
 * decision the model can make has a default here, and this is what a
 * pokemon does when the key is missing, the cap is spent or the call fails.
 */

import { SLEEPY_ENERGY } from "@/lib/sim";
import { hashString, mulberry32, pick } from "./random";
import type { BrainActivity, Emote, TickContext, TickPlan } from "./types";

/** Traits that make a bored pokemon act out. */
export const MISCHIEF_TRAITS: readonly string[] = ["mischievous", "stubborn", "greedy", "naughty", "bold"];

/** One generator per (seed, minute). Ticks within the same minute agree; the next minute rolls again. */
export function rulesRandom(promptSeed: number, now: string, salt = ""): () => number {
  return mulberry32((promptSeed ^ hashString(`${now.slice(0, 16)}|${salt}`)) >>> 0);
}

export function rulesTick(ctx: TickContext): TickPlan {
  const { state, menu, mood } = ctx;
  const rand = rulesRandom(ctx.personality.promptSeed, ctx.now, "tick");
  const has = (a: BrainActivity) => menu.activities.includes(a);

  if (state.asleep) return { activity: "sleep", emote: has("sleep") && rand() < 0.3 ? "sleepy" : undefined, cry: false };

  let activity: BrainActivity = "idle";
  if (has("sleep") && (state.needs.energy < SLEEPY_ENERGY / 2 || (ctx.local.night && state.needs.energy < SLEEPY_ENERGY))) {
    activity = "sleep";
  } else if (mood.label === "hungry" || mood.label === "bored") {
    // Pacing about is what a hungry or bored pokemon does; it also makes the state visible.
    activity = has("walk") ? "walk" : "idle";
  } else {
    const roll = rand();
    const extras = menu.activities.filter((a) => a === "swim" || a === "fly");
    if (roll < 0.45) activity = "idle";
    else if (roll < 0.8 || extras.length === 0) activity = has("walk") ? "walk" : "idle";
    else activity = pick(rand, extras);
  }
  if (!has(activity)) activity = menu.activities[0] ?? "idle";

  const emote: Emote | undefined = menu.emotes.length > 0 && rand() < (mood.score < 45 ? 0.6 : 0.35) ? pick(rand, menu.emotes) : undefined;
  const cry = (mood.label === "joyful" || mood.label === "happy") && rand() < 0.15;

  const mischievous = ctx.personality.traits.some((t) => MISCHIEF_TRAITS.includes(t));
  const misbehaving = menu.canMisbehave && mischievous && rand() < 0.2 ? true : undefined;

  return { activity, emote, cry, ...(misbehaving ? { misbehaving } : {}) };
}

/** A canned reply when the trainer talks and no model answers. */
export function rulesReply(ctx: TickContext): { line: string; emote: Emote; cry: boolean; activity?: BrainActivity } {
  const rand = rulesRandom(ctx.personality.promptSeed, ctx.now, "talk");
  const name = ctx.relationship?.callsThem ?? ctx.trainer.name;
  const lines: Record<string, string[]> = {
    asleep: ["(a sleepy murmur, still dreaming)", "(rolls over, does not wake)"],
    sick: ["(a weak cry; it wants to rest)", "(looks up at you, then curls back up)"],
    hungry: [`(looks at ${name}, then at where food would be)`, "(stomach growls; a pointed stare)"],
    tired: ["(a long yawn aimed your way)", "(blinks slowly; too tired to say much)"],
    grubby: ["(shakes off some dirt, looks embarrassed)", "(scratches; it wants a groom)"],
    bored: [`(bounces once: play with me, ${name}?)`, "(nudges you, waiting for a game)"],
    lonely: [`(presses close to ${name})`, "(a small cry: stay a while)"],
    sleepy: ["(a drowsy chirp, half listening)", "(settles down nearby, eyes closing)"],
    joyful: [`(a bright cry: hello, ${name}!)`, "(hops in a circle, delighted)"],
    happy: [`(a happy cry back at ${name})`, "(tilts its head, pleased you are here)"],
    content: ["(a short cry, calm and warm)", "(looks up, listening)"],
    glum: ["(a low cry; something is bothering it)", "(looks away, then back at you)"],
    miserable: ["(a thin cry; it needs looking after)", "(barely answers; it is not well)"],
  };
  const pool = lines[ctx.mood.label] ?? lines.content;
  const emote = ctx.menu.emotes.length > 0 ? pick(rand, ctx.menu.emotes) : "question";
  const cry = !ctx.state.asleep && rand() < 0.7;
  return { line: pick(rand, pool), emote, cry };
}
