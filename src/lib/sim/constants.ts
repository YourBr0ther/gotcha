/**
 * Every balance value in the simulation. Nothing else in src/lib/sim holds a
 * tunable number, and tests are written relative to these so a retune does
 * not rewrite them.
 *
 * Durations are milliseconds. Rates are points per hour on the 0 to 100 need
 * scale unless the name says otherwise.
 */

import type { NeedName, Needs } from "@gotcha/cpkmn";

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const NEED_MIN = 0;
export const NEED_MAX = 100;

/** Decay per hour for an awake, neutral pokemon. Health has no base decay. */
export const DECAY_PER_HOUR: Readonly<Needs> = {
  hunger: 6.5, // 100 -> 20 in ~12h: feed twice a day
  energy: 5, // 100 -> 20 in 16h: sleep nightly
  hygiene: 3, // 100 -> 20 in ~27h before messes: groom daily
  fun: 8, // 100 -> 20 in 10h: play a couple of times a day
  affection: 4, // 100 -> 20 in 20h: pet or talk daily
  health: 0,
};

/** Personality and species multipliers are clamped to this range. */
export const DECAY_MULTIPLIER_MIN = 0.5;
export const DECAY_MULTIPLIER_MAX = 1.5;

/** Multiplies decay while asleep. Energy is handled by ENERGY_RECOVERY_PER_HOUR. */
export const SLEEP_DECAY_MULTIPLIER: Readonly<Needs> = {
  hunger: 0.5,
  energy: 0,
  hygiene: 0.5,
  fun: 0.5,
  affection: 0.5,
  health: 1,
};

/** Energy regained per hour of sleep. 0 -> 100 in a little over 8 hours. */
export const ENERGY_RECOVERY_PER_HOUR = 12;

/** A pokemon that reaches this much energy while asleep wakes on its own. */
export const AUTO_WAKE_ENERGY = NEED_MAX;
/** A pokemon that runs out of energy while awake falls asleep where it stands. */
export const AUTO_SLEEP_ENERGY = NEED_MIN;

/** Hunger and hygiene under these drain health. */
export const LOW_THRESHOLD: Readonly<Pick<Needs, "hunger" | "hygiene">> = {
  hunger: 20,
  hygiene: 20,
};

/** Health drain per hour from each cause. Sickness drain is multiplied by severity. */
export const HEALTH_DRAIN_PER_HOUR = {
  hunger: 4,
  hygiene: 3,
  sickness: 2,
} as const;

/** Health regained per hour when nothing is draining it. */
export const HEALTH_RECOVERY_PER_HOUR = { awake: 3, asleep: 6 } as const;

/** Sickness starts when health falls under this while being drained. */
export const SICKNESS_ONSET_HEALTH = 50;
/** Severity climbs as health keeps falling. Index is severity minus two. */
export const SICKNESS_SEVERITY_HEALTH: readonly [number, number] = [30, 15];
/**
 * Continuous sleep that clears sickness, provided hunger and hygiene are
 * fine. A sick pokemon whose rest can clear it sleeps through full energy
 * until this passes.
 */
export const SICKNESS_REST_CLEAR = 8 * HOUR;

/**
 * Foraging. An awake pokemon whose hunger falls to the start line goes and
 * finds something itself: it is in a meadow or a forest, after all. Wild
 * food is poor, so it only ever brings hunger back up to the ceiling,
 * never full, and rooting around costs some hygiene. From the ceiling the
 * base rate reaches the start line again in a little over two hours, so a
 * pokemon left alone hovers in the "getting low" band instead of starving,
 * and the hunger threshold is only crossed in its sleep. Food from the
 * trainer is still the only way to be full, and a dirty pokemon still gets
 * sick.
 */
export const FORAGE = {
  startHunger: 30,
  ceiling: 45,
  hygieneCost: 5,
} as const;

/** Messes happen on this clock while awake and knock hygiene down in one go. */
export const MESS_INTERVAL = 8 * HOUR;
export const MESS_HYGIENE_DROP = 15;

/** Care action effects. Fill values add to a need and clamp at NEED_MAX. */
export const CARE = {
  feed: { affection: 3, overfeedThreshold: 90, overfeedHygieneDrop: MESS_HYGIENE_DROP },
  play: {
    fun: 30,
    affection: 5,
    energyCost: 10,
    hungerCost: 5,
    hygieneCost: 3,
    /** Under this much energy the pokemon only half enjoys play. */
    tiredEnergy: 15,
  },
  groom: { hygiene: NEED_MAX, affection: 2 },
  rest: {
    /** At or above this energy the pokemon refuses to go to bed. */
    refuseEnergy: 90,
  },
  wake: {
    /** Waking under this energy is a care mistake. */
    safeEnergy: 80,
    affectionPenalty: 5,
  },
  medicine: { health: 40, unneededAffectionPenalty: 4 },
  discipline: { affectionCost: 3, unjustAffectionPenalty: 8 },
  pet: { affection: 8, fun: 3 },
} as const;

/** A need that climbs to NEED_MAX from under this pays the recovery milestone. */
export const RECOVERY_LOW = 20;

/** Experience per care action. */
export const CARE_EXPERIENCE = {
  feed: 4,
  play: 8,
  groom: 4,
  rest: 2,
  wake: 0,
  medicine: 5,
  discipline: 1,
  pet: 2,
} as const;

/** Base friendship change per care action, before the tier scaling in growth. */
export const CARE_FRIENDSHIP = {
  feed: 3,
  play: 5,
  groom: 3,
  rest: 1,
  wake: 0,
  medicine: 3,
  discipline: -2,
  pet: 4,
} as const;

/** Friendship lost per care mistake. */
export const CARE_MISTAKE_FRIENDSHIP = -5;

/** Experience per hour spent as the active pokemon. */
export const ACTIVE_EXPERIENCE_PER_HOUR = 6;

export const MAX_LEVEL = 100;
export const FRIENDSHIP_MAX = 255;
/**
 * Friendship gains shrink as friendship rises, like the games. A base gain
 * is multiplied by the factor for the first tier whose ceiling exceeds the
 * current value. Losses are not scaled.
 */
export const FRIENDSHIP_TIERS: readonly { below: number; factor: number }[] = [
  { below: 100, factor: 1 },
  { below: 200, factor: 0.6 },
  { below: FRIENDSHIP_MAX + 1, factor: 0.4 },
];

/** Mood is a weighted mean of the needs, then nudged by temperament and time. */
export const MOOD_WEIGHTS: Readonly<Needs> = {
  hunger: 0.25,
  energy: 0.15,
  hygiene: 0.1,
  fun: 0.2,
  affection: 0.2,
  health: 0.1,
};
/** A need under this takes over the mood label. */
export const MOOD_LOW_THRESHOLD = 30;
/** Score at or above each entry picks its label; the last is the floor. */
export const MOOD_BANDS: readonly { atLeast: number; label: "joyful" | "happy" | "content" | "glum" | "miserable" }[] = [
  { atLeast: 85, label: "joyful" },
  { atLeast: 65, label: "happy" },
  { atLeast: 45, label: "content" },
  { atLeast: 25, label: "glum" },
  { atLeast: 0, label: "miserable" },
];
export const MOOD_TEMPERAMENT_BIAS: Readonly<Record<string, number>> = {
  playful: 5,
  calm: 3,
  bold: 0,
  timid: -3,
  grumpy: -8,
};
/** Local hours counted as night for the sleepy mood. */
export const NIGHT_START_HOUR = 21;
export const NIGHT_END_HOUR = 6;
/** Awake at night under this energy reads as sleepy. */
export const SLEEPY_ENERGY = 50;

/** Bytes. */
export const STIPEND_THRESHOLD = 50;
export const STIPEND_MAX = 40;
export const STIPEND_FULL_CARE_BONUS = 10;

export const MINIGAME_BASE_BYTES = 20;
export const MINIGAME_BASE_EXPERIENCE = 15;
/** Each game played today divides the next payout a little more. */
export const MINIGAME_HALF_LIFE_GAMES = 4;
/** Payout multiplier never falls under this. */
export const MINIGAME_FLOOR = 0.1;
/** Mini-games never pay more than this in a day. */
export const MINIGAME_DAILY_CAP = 120;

/** "Not now" on an evolution keeps the question away this long. */
export const EVOLUTION_SNOOZE = 3 * DAY;

export const MILESTONE_BYTES = {
  level_up: 25,
  evolution: 150,
  recovery: 15,
  first_import: 50,
} as const;

/** Store item definitions. store.ts turns these into StoreItem objects. */
export const STORE_ITEMS = {
  oran_berry: { category: "berry", price: 8, fill: { hunger: 20, fun: 2 }, flavors: ["sweet"] },
  sitrus_berry: { category: "berry", price: 12, fill: { hunger: 25, health: 5 }, flavors: ["sour"] },
  cheri_berry: { category: "berry", price: 8, fill: { hunger: 18, fun: 4 }, flavors: ["spicy"] },
  chesto_berry: { category: "berry", price: 8, fill: { hunger: 18, energy: 5 }, flavors: ["dry"] },
  pecha_berry: { category: "berry", price: 8, fill: { hunger: 18, affection: 3 }, flavors: ["sweet"] },
  rawst_berry: { category: "berry", price: 8, fill: { hunger: 18, hygiene: 3 }, flavors: ["bitter"] },
  sweet_poffin: { category: "poffin", price: 30, fill: { hunger: 50, fun: 8 }, flavors: ["sweet"] },
  spicy_poffin: { category: "poffin", price: 30, fill: { hunger: 50, energy: 8 }, flavors: ["spicy"] },
  curry: { category: "curry", price: 55, fill: { hunger: 100, fun: 10, affection: 5 }, flavors: ["spicy", "sweet"] },
  potion: { category: "potion", price: 40, fill: { health: 30 } },
  super_potion: { category: "potion", price: 90, fill: { health: 70 } },
  medicine: { category: "medicine", price: 60, cureSickness: true, fill: { health: 20 } },
  ball_toy: { category: "toy", price: 45, fill: { fun: 10 }, modifier: { need: "fun", factor: 0.7, duration: DAY } },
  plush_toy: { category: "toy", price: 70, fill: { affection: 10 }, modifier: { need: "affection", factor: 0.7, duration: DAY } },
  flower_pot: { category: "decoration", price: 25 },
  lantern: { category: "decoration", price: 35 },
  bed_roll: { category: "decoration", price: 50 },
  diorama_forest: { category: "diorama", price: 300, unlock: "forest" },
  diorama_beach: { category: "diorama", price: 300, unlock: "beach" },
  diorama_cave: { category: "diorama", price: 350, unlock: "cave" },
  link_cable: { category: "key", price: 200 },
  fire_stone: { category: "key", price: 250 },
  water_stone: { category: "key", price: 250 },
  thunder_stone: { category: "key", price: 250 },
  leaf_stone: { category: "key", price: 250 },
  moon_stone: { category: "key", price: 250 },
} as const satisfies Record<
  string,
  {
    category: string;
    price: number;
    fill?: Partial<Record<NeedName, number>>;
    flavors?: readonly string[];
    cureSickness?: boolean;
    modifier?: { need: NeedName; factor: number; duration: number };
    unlock?: string;
  }
>;

export type StoreItemId = keyof typeof STORE_ITEMS;
