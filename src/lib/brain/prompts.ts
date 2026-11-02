/**
 * Prompt assembly. Every prompt is XML-tagged blocks in a fixed order, the
 * same order for ticks, conversation and the roll-up, so a transcript reads
 * the same whichever call produced it. The state block is the engine's
 * truth for this turn; the model is never asked to remember a number.
 */

import type { EpisodicEvent, Personality, Relationship, State } from "@gotcha/cpkmn";
import type { Mood } from "@/lib/sim";
import { LINE_MAX_CHARS, PAGE_MAX_CHARS, RECENT_EVENTS, SUMMARY_TARGET_CHARS } from "./constants";
import { DIORAMA_FACTS } from "./menu";
import type { BrainSpeciesFacts, LocalTime, Menu, TickContext } from "./types";

/** Tag names in the order they appear. Tests check the order against this. */
export const BLOCK_ORDER = [
  "species_facts",
  "personality",
  "state",
  "location_time",
  "memory_summary",
  "recent_events",
  "relationship",
  "menu",
  "output_schema",
] as const;

export type BlockName = (typeof BLOCK_ORDER)[number];

function block(name: string, body: string): string {
  return `<${name}>\n${body.trim()}\n</${name}>`;
}

function list(items: readonly string[] | undefined): string {
  return items && items.length > 0 ? items.join(", ") : "none recorded";
}

function behaviourSummary(facts: BrainSpeciesFacts): string {
  const b = facts.behaviour;
  if (!b) return "nothing special recorded";
  const parts: string[] = [];
  const walk = b.moving?.walk;
  const swim = b.moving?.swim;
  const fly = b.moving?.fly;
  if (walk?.canWalk === false) parts.push("does not walk");
  if (swim?.canSwimInWater) parts.push(swim.canBreatheUnderwater ? "swims and breathes underwater" : "swims");
  if (swim?.avoidsWater) parts.push("avoids water");
  if (fly?.canFly) parts.push("flies");
  const rest = b.resting;
  if (rest?.canSleep === false) parts.push("never sleeps");
  else if (rest?.times) parts.push(`sleeps in the ${rest.times}`);
  if (rest?.light) parts.push(`prefers ${rest.light} light to rest`);
  return parts.length > 0 ? parts.join("; ") : "walks, rests when tired";
}

export function speciesBlock(facts: BrainSpeciesFacts): string {
  const lines = [
    `species: ${facts.name} (${facts.species})`,
    `types: ${list(facts.types)}`,
    `habitat: ${facts.habitat ?? "unknown"}`,
    `pokedex: ${list([...(facts.flavorTexts ?? []).slice(0, 2), ...(facts.pokedexLines ?? []).slice(0, 2)])}`,
    `behaviour: ${behaviourSummary(facts)}`,
  ];
  if (facts.spawnBiomes && facts.spawnBiomes.length > 0) lines.push(`found in: ${facts.spawnBiomes.slice(0, 5).join(", ")}`);
  return lines.join("\n");
}

export function personalityBlock(p: Personality): string {
  const foods = Object.entries(p.preferences.foods ?? {})
    .map(([id, weight]) => `${id.replace(/_/g, " ")} (${weight >= 1 ? "likes" : "dislikes"})`)
    .join(", ");
  const lines = [
    `traits: ${list(p.traits)}`,
    `temperament: ${p.temperament}`,
    `likes: ${list(p.likes)}`,
    `dislikes: ${list(p.dislikes)}`,
    `food: ${foods || "no strong opinions"}`,
    `voice: ${p.voice.chatter ?? "short cries, few words"}`,
    `quirks: ${list(p.voice.quirks)}`,
  ];
  return lines.join("\n");
}

function needWord(value: number): string {
  if (value >= 80) return "full";
  if (value >= 55) return "fine";
  if (value >= 30) return "getting low";
  if (value >= 15) return "low";
  return "critical";
}

export function stateBlock(state: State, mood: Mood): string {
  const n = state.needs;
  const lines = [
    `mood: ${mood.label} (score ${Math.round(mood.score)} of 100)`,
    `hunger: ${Math.round(n.hunger)} (${needWord(n.hunger)}; lower means hungrier)`,
    `energy: ${Math.round(n.energy)} (${needWord(n.energy)})`,
    `hygiene: ${Math.round(n.hygiene)} (${needWord(n.hygiene)})`,
    `fun: ${Math.round(n.fun)} (${needWord(n.fun)})`,
    `affection: ${Math.round(n.affection)} (${needWord(n.affection)})`,
    `health: ${Math.round(n.health)} (${needWord(n.health)})`,
    `asleep: ${state.asleep ? "yes" : "no"}`,
    `sick: ${state.sickness ? `yes, ${state.sickness.kind} severity ${state.sickness.severity}` : "no"}`,
    `current activity: ${state.activity}`,
    `misbehaving: ${state.flags?.misbehaving ? "yes" : "no"}`,
  ];
  return lines.join("\n");
}

export function locationBlock(state: State, local: LocalTime, now: string): string {
  const d = DIORAMA_FACTS[state.location.diorama];
  return [
    `place: ${d ? `${d.label}, ${d.description}` : state.location.diorama}`,
    state.location.spot ? `spot: ${state.location.spot}` : null,
    `time: ${local.period}, ${String(local.hour).padStart(2, "0")}:00 local${local.night ? ", night" : ""}`,
    `date: ${now.slice(0, 10)}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export function summaryBlock(summary: string): string {
  return summary.trim() || "No memories yet. This is early days.";
}

export function eventsBlock(events: readonly EpisodicEvent[], limit = RECENT_EVENTS): string {
  const recent = events.slice(-limit);
  if (recent.length === 0) return "nothing yet today";
  return recent.map((e) => `- ${e.ts.slice(0, 16).replace("T", " ")} [${e.kind}] ${e.summary}${e.emotion ? ` (felt ${e.emotion})` : ""}`).join("\n");
}

export function relationshipBlock(trainer: { id: string; name: string }, rel: Relationship | null): string {
  if (!rel) return `trainer present: ${trainer.name}. You have no notes on them yet.`;
  return [
    `trainer present: ${trainer.name}`,
    `you call them: ${rel.callsThem ?? trainer.name}`,
    `bond: ${rel.bond} of 100`,
    `notes: ${list(rel.notes)}`,
  ].join("\n");
}

export function menuBlock(menu: Menu): string {
  return [
    `activities (pick exactly one): ${menu.activities.join(", ")}`,
    `emotes (pick one or none): ${menu.emotes.join(", ")}`,
    `misbehaving: ${menu.canMisbehave ? "you may start misbehaving this turn if that is in character" : "not an option right now"}`,
  ].join("\n");
}

export const TICK_SCHEMA_TEXT = [
  "Answer with one JSON object and nothing else:",
  "{",
  '  "activity": one of the activities on the menu,',
  '  "emote": one of the emotes on the menu, or omit,',
  `  "line": optional, under ${LINE_MAX_CHARS} characters, the gist of what your cry means, in your own voice, or omit when you have nothing to say,`,
  '  "cry": true or false, whether you make your cry sound,',
  '  "misbehaving": true only if the menu allows it and you choose to',
  "}",
].join("\n");

export const TALK_SCHEMA_TEXT = [
  "Answer with one JSON object and nothing else:",
  "{",
  `  "line": under ${LINE_MAX_CHARS} characters, the gist of your reply as your trainer would understand it,`,
  '  "emote": one of the emotes on the menu,',
  '  "cry": true or false,',
  '  "activity": optional, one of the activities on the menu, if what they said makes you do something,',
  '  "importance": 1, 2 or 3, how much this exchange matters to you',
  "}",
].join("\n");

export function systemPrompt(ctx: Pick<TickContext, "name" | "facts" | "personality">): string {
  return [
    `You are ${ctx.name}, a ${ctx.facts.name} pokemon living wild in a corner of the pokemon world, looked after by a family.`,
    "You cannot speak human language. You communicate with cries, body language and emotes.",
    `Any "line" you give is the translated gist of a cry, under ${LINE_MAX_CHARS} characters, in your own voice: ${ctx.personality.voice.chatter ?? "short and simple"}.`,
    "Stay in character. Pick only from the menu. Never invent items, stats, levels or events.",
    "The numbers in the state block are the truth for this moment; do not reason about numbers you remember from before.",
  ].join(" ");
}

/** The tick prompt: all nine blocks in BLOCK_ORDER. */
export function tickPrompt(ctx: TickContext): string {
  return [
    block("species_facts", speciesBlock(ctx.facts)),
    block("personality", personalityBlock(ctx.personality)),
    block("state", stateBlock(ctx.state, ctx.mood)),
    block("location_time", locationBlock(ctx.state, ctx.local, ctx.now)),
    block("memory_summary", summaryBlock(ctx.summary)),
    block("recent_events", eventsBlock(ctx.recentEvents)),
    block("relationship", relationshipBlock(ctx.trainer, ctx.relationship)),
    block("menu", menuBlock(ctx.menu)),
    block("output_schema", TICK_SCHEMA_TEXT),
  ].join("\n\n");
}

/** The conversation prompt: the tick blocks, then what the trainer said, then the talk schema. */
export function talkPrompt(ctx: TickContext, text: string): string {
  return [
    block("species_facts", speciesBlock(ctx.facts)),
    block("personality", personalityBlock(ctx.personality)),
    block("state", stateBlock(ctx.state, ctx.mood)),
    block("location_time", locationBlock(ctx.state, ctx.local, ctx.now)),
    block("memory_summary", summaryBlock(ctx.summary)),
    block("recent_events", eventsBlock(ctx.recentEvents)),
    block("relationship", relationshipBlock(ctx.trainer, ctx.relationship)),
    block("menu", menuBlock(ctx.menu)),
    block("trainer_said", `${ctx.trainer.name} says to you: "${text.trim()}"`),
    block("output_schema", TALK_SCHEMA_TEXT),
  ].join("\n\n");
}

export const ROLLUP_SCHEMA_TEXT = [
  "Answer with one JSON object and nothing else:",
  "{",
  `  "page": today's diary page: two to four short sentences, first person, only about what happened today, under ${PAGE_MAX_CHARS} characters; what mattered most, the hard part if there was one, and how you feel tonight; never say that something did not happen,`,
  `  "summary": the memory you carry forward, under ${SUMMARY_TARGET_CHARS} characters, three to six plain sentences: who your trainer is to you, how long you have been together, what still matters from before, how things stand lately; fold today in and let old detail fade, it is what you would still remember next month and not a diary,`,
  '  "feeling": one or two words for how today felt to you,',
  '  "callsThem": optional, a short name you use for the trainer,',
  '  "notes": up to three short new notes about the trainer from today, or an empty array,',
  '  "bondDelta": an integer from -5 to 5, how today moved your bond with the trainer',
  "}",
].join("\n");

/** The roll-up is a diary, not a cry, so it gets its own frame instead of the tick's. */
export function rollupSystemPrompt(ctx: Pick<RollupContext, "name" | "facts" | "personality">): string {
  return [
    `You are ${ctx.name}, a ${ctx.facts.name} pokemon living wild in a corner of the pokemon world, looked after by a family, writing in your diary at the end of the day.`,
    `Write in first person in short plain sentences a child could read, in your own voice: ${ctx.personality.voice.chatter ?? "short and simple"}.`,
    "Only what is in the day's events happened. Never invent items, levels, places or events.",
    "Your likes, dislikes and quirks are already known; leave them out unless today changed one.",
    "Do not retell earlier days in the page; the summary is where the past lives, and it should get shorter about old days as new ones come.",
  ].join(" ");
}

export interface RollupContext {
  name: string;
  facts: BrainSpeciesFacts;
  personality: Personality;
  summary: string;
  dayEvents: EpisodicEvent[];
  trainer: { id: string; name: string };
  relationship: Relationship | null;
  day: string;
}

export function rollupPrompt(ctx: RollupContext): string {
  return [
    block("species_facts", speciesBlock(ctx.facts)),
    block("personality", personalityBlock(ctx.personality)),
    block("memory_summary", summaryBlock(ctx.summary)),
    block("day_events", `date: ${ctx.day}\n${eventsBlock(ctx.dayEvents, 60)}`),
    block("relationship", relationshipBlock(ctx.trainer, ctx.relationship)),
    block("output_schema", ROLLUP_SCHEMA_TEXT),
  ].join("\n\n");
}

/** A line never passes the limit; a long one is cut at the last space with an ellipsis. */
export function clipLine(line: string | undefined | null, max = LINE_MAX_CHARS): string | undefined {
  if (!line) return undefined;
  const clean = line.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
