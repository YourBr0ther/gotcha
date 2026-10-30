/**
 * Writes docs/balance.md from the engine's constants and a dry run of the
 * engine itself, so the table can never drift from the code.
 *
 *   pnpm sim:balance
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { NEED_NAMES, type NeedName } from "@gotcha/cpkmn";
import {
  CARE_EXPERIENCE,
  CARE_FRIENDSHIP,
  DAY,
  DECAY_PER_HOUR,
  ENERGY_RECOVERY_PER_HOUR,
  HEALTH_DRAIN_PER_HOUR,
  HOUR,
  LOW_THRESHOLD,
  MESS_HYGIENE_DROP,
  MESS_INTERVAL,
  MILESTONE_BYTES,
  MINIGAME_DAILY_CAP,
  MINUTE,
  NEED_MAX,
  SICKNESS_ONSET_HEALTH,
  SICKNESS_REST_CLEAR,
  SLEEP_DECAY_MULTIPLIER,
  STIPEND_FULL_CARE_BONUS,
  STIPEND_MAX,
  CARE_ACTIONS,
  dailyStipend,
  decay,
  freshState,
  fullNeeds,
  miniGamePayout,
  neutralPersonality,
  neutralSpecies,
  storeCatalog,
  toIso,
  type StoreItem,
} from "../src/lib/sim";

const TARGET = 20;
const T0 = "2026-01-01T08:00:00.000Z";
const t0 = Date.parse(T0);
const STEP = 5 * MINUTE;
const LIMIT = 7 * DAY;

const hours = (ms: number) => `${(ms / HOUR).toFixed(1)} h`;
const never = "never";

/** Walk an untouched, awake, neutral pokemon forward and note when each need first reaches the target. */
function simulate() {
  const personality = neutralPersonality();
  const species = neutralSpecies();
  let state = freshState(T0);
  const reached: Partial<Record<NeedName, number>> = {};
  let sickAt: number | null = null;
  let firstSleepAt: number | null = null;
  for (let ms = STEP; ms <= LIMIT; ms += STEP) {
    const { state: next, events } = decay(state, personality, species, toIso(t0 + ms));
    for (const need of NEED_NAMES) if (reached[need] === undefined && next.needs[need] <= TARGET) reached[need] = ms;
    for (const e of events) {
      if (e.kind === "sickness_started" && sickAt === null) sickAt = Date.parse(e.at) - t0;
      if (e.kind === "fell_asleep" && firstSleepAt === null) firstSleepAt = Date.parse(e.at) - t0;
    }
    state = next;
  }
  return { reached, sickAt, firstSleepAt };
}

const MEANING: Record<NeedName, string> = {
  hunger: "feed about twice a day",
  energy: "sleep every night",
  hygiene: "groom about once a day",
  fun: "play a couple of times a day",
  affection: "pet or talk once a day",
  health: "only falls while hungry, dirty or sick",
};

function needsTable(): string {
  const { reached, sickAt, firstSleepAt } = simulate();
  const rows = NEED_NAMES.map((need) => {
    const rate = DECAY_PER_HOUR[need];
    const analytic = rate > 0 ? hours(HOUR * ((NEED_MAX - TARGET) / rate)) : never;
    const simulated = reached[need] !== undefined ? hours(reached[need]!) : never;
    return `| ${need} | ${rate} | ${analytic} | ${simulated} | ${MEANING[need]} |`;
  });
  const night = HOUR * (NEED_MAX / ENERGY_RECOVERY_PER_HOUR);
  const notes = [
    `A full night of sleep (0 to ${NEED_MAX} energy) takes ${hours(night)}, during which hunger falls ${(DECAY_PER_HOUR.hunger * SLEEP_DECAY_MULTIPLIER.hunger * (night / HOUR)).toFixed(0)} points.`,
    `Messes every ${hours(MESS_INTERVAL)} while awake knock hygiene down ${MESS_HYGIENE_DROP}, which is why the simulated hygiene time is shorter than the base rate.`,
    `Left alone from full, the pokemon falls asleep from exhaustion at ${firstSleepAt === null ? never : hours(firstSleepAt)} and gets sick at ${sickAt === null ? never : hours(sickAt)}.`,
    `Health drains ${HEALTH_DRAIN_PER_HOUR.hunger}/h while hunger is under ${LOW_THRESHOLD.hunger} and ${HEALTH_DRAIN_PER_HOUR.hygiene}/h while hygiene is under ${LOW_THRESHOLD.hygiene}; sickness starts when health reaches ${SICKNESS_ONSET_HEALTH} that way, and clears with medicine or ${hours(SICKNESS_REST_CLEAR)} of unbroken sleep on a fed, clean pokemon.`,
  ];
  return [
    "| Need | Base decay /h | 100 to 20 at base rate | 100 to 20 simulated, untouched | Means |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    ...notes.map((n) => `- ${n}`),
  ].join("\n");
}

function describe(item: StoreItem): string {
  const parts: string[] = [];
  const fill = item.effects.fill ?? {};
  for (const need of NEED_NAMES) if (fill[need]) parts.push(`${need} +${fill[need]}`);
  if (item.effects.cureSickness) parts.push("cures sickness");
  if (item.effects.modifier) {
    const m = item.effects.modifier;
    parts.push(`${m.need} decay x${m.factor} for ${hours(m.duration)} when used in play`);
  }
  if (item.effects.unlock) parts.push(`unlocks the ${item.effects.unlock} diorama`);
  if (item.category === "key") parts.push("evolution trigger");
  if (item.category === "decoration") parts.push("diorama decoration");
  return parts.join(", ");
}

function storeTable(): string {
  const rows = storeCatalog().map((item) => `| ${item.id} | ${item.category} | ${item.price} | ${describe(item)} |`);
  return ["| Item | Category | Bytes | Effect |", "|---|---|---|---|", ...rows].join("\n");
}

function economyTable(): string {
  const perfect = { game: "any", score: 1, durationMs: 60 * 1000, completed: true };
  let earned = 0;
  const rows: string[] = [];
  for (let game = 1; game <= 10; game++) {
    const { bytes, experience } = miniGamePayout(perfect, { gamesPlayed: game - 1, bytesEarned: earned });
    earned += bytes;
    rows.push(`| ${game} | ${bytes} | ${experience} | ${earned} |`);
  }
  const stipend = dailyStipend([fullNeeds()]);
  return [
    "Perfect-score mini-games through one day:",
    "",
    "| Game of the day | Bytes | Experience | Bytes so far |",
    "|---|---|---|---|",
    ...rows,
    "",
    `Mini-games cap at ${MINIGAME_DAILY_CAP} Bytes a day. A day with every need above the stipend line pays ${stipend} (${STIPEND_MAX} plus the ${STIPEND_FULL_CARE_BONUS} full-care bonus).`,
    "",
    "| Milestone | Bytes |",
    "|---|---|",
    ...Object.entries(MILESTONE_BYTES).map(([k, v]) => `| ${k} | ${v} |`),
  ].join("\n");
}

function careTable(): string {
  const rows = CARE_ACTIONS.map((a) => `| ${a} | ${CARE_EXPERIENCE[a]} | ${CARE_FRIENDSHIP[a]} |`);
  return ["| Care action | Experience | Base friendship |", "|---|---|---|", ...rows].join("\n");
}

const doc = `# Balance

Generated by \`pnpm sim:balance\` from \`src/lib/sim/constants.ts\`. Do not edit
by hand; retune the constants and rerun.

## Needs

A neutral pokemon (every multiplier 1), awake and left alone from full.

${needsTable()}

## Store

${storeTable()}

## Bytes

${economyTable()}

## Care

${careTable()}
`;

const out = path.resolve(process.cwd(), "docs/balance.md");
writeFileSync(out, doc);
console.log(`wrote ${out}`);
