/**
 * A trainer's first pokemon: engine defaults plus what species.json knows.
 * The brain and the pokedex will fill personality and the dex snapshot
 * properly later; until then the neutral fixtures are the starting point.
 */

import { randomUUID } from "node:crypto";
import { validateMember, type CpkmnPokemon, type Gender } from "@gotcha/cpkmn";
import { createPersonality, enrichVoice } from "@/lib/brain/personality";
import { factsFromPokedex } from "@/lib/brain/menu";
import { freshState, freshStats, type Temperament } from "@/lib/sim";
import { schema, type Db } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { freeSlot, lockAll } from "./pokemon";
import { getSpecies, pokedexSnapshot, type SpeciesRecord } from "./species";

export const NATURES = [
  "hardy", "lonely", "brave", "adamant", "naughty",
  "bold", "docile", "relaxed", "impish", "lax",
  "timid", "hasty", "serious", "jolly", "naive",
  "modest", "mild", "quiet", "bashful", "rash",
  "calm", "gentle", "sassy", "careful", "quirky",
] as const;

export const TEMPERAMENTS: readonly Temperament[] = ["playful", "calm", "bold", "timid", "grumpy"];

export interface StarterInput {
  species: string;
  nickname?: string;
  gender?: Gender;
}

function rollGender(record: SpeciesRecord, random: () => number): Gender {
  if (record.maleRatio < 0) return "genderless";
  return random() < record.maleRatio ? "male" : "female";
}

/** The whole pokemon as it would sit in a .cpkmn, before the row exists. */
export function buildStarter(record: SpeciesRecord, trainer: TrainerRow, input: StarterInput, now: string, random: () => number = Math.random): CpkmnPokemon {
  const nickname = input.nickname?.trim();
  if (nickname && nickname.length > 12) throw new ServiceError("bad_request", "nicknames are at most 12 characters");
  const gender = input.gender ?? rollGender(record, random);
  const aspects = record.aspects.includes(gender) ? [gender] : [];
  const trainerRef = { trainerId: trainer.id, name: trainer.displayName };
  const stats = freshStats(record.experienceGroup);
  stats.friendship = record.baseFriendship;
  const pokedex = pokedexSnapshot(record, now);
  // The brain's seeded generator; the same seed gives the same pokemon on any install.
  const personality = createPersonality(factsFromPokedex(pokedex), Math.floor(random() * 2 ** 31));

  const pokemon: CpkmnPokemon = {
    identity: {
      pokemonId: randomUUID(),
      species: record.species,
      nationalDex: record.nationalDex,
      form: "normal",
      aspects,
      ...(nickname ? { nickname } : {}),
      gender,
      shiny: false,
      nature: NATURES[Math.floor(random() * NATURES.length)],
      ability: record.abilities[0] ?? "none",
      hiddenAbility: false,
      ballType: "poke_ball",
      originalTrainer: trainerRef,
      currentTrainer: trainerRef,
      hatchedAt: now,
      origin: "starter",
    },
    stats,
    state: freshState(now),
    personality,
    memories: { summary: "", episodic: [], relationships: {} },
    pokedex,
    inventory: { heldItem: null, cosmetics: [] },
    history: {
      origin: { kind: "starter", at: now, detail: `Chosen by ${trainer.displayName}` },
      trainers: [{ trainerId: trainer.id, name: trainer.displayName, from: now, to: null }],
      trades: [],
      milestones: [],
      imports: [],
    },
  };
  // A starter that would not export is a bug here, not in the exporter.
  for (const member of ["identity", "stats", "state", "personality", "pokedex", "inventory", "history"] as const) {
    const failures = validateMember(member, pokemon[member]);
    if (failures.length > 0) throw new Error(`starter ${member} fails the cpkmn schema: ${JSON.stringify(failures)}`);
  }
  return pokemon;
}

export async function createStarter(db: Db, trainer: TrainerRow, input: StarterInput, now = new Date().toISOString()): Promise<PokemonRow> {
  const record = await getSpecies(input.species);
  const pokemon = buildStarter(record, trainer, input, now);
  // With a key the model writes the voice; without one the rules-made voice stays.
  pokemon.personality = await enrichVoice(pokemon.personality, factsFromPokedex(pokemon.pokedex));

  return db.transaction(async (tx) => {
    const owned = await lockAll(tx, trainer.id);
    if (owned.length > 0) throw new ServiceError("starter_already_chosen", "this trainer already has a pokemon; more arrive by trade, gift or egg");
    const slot = freeSlot(owned);
    if (slot === null) throw new ServiceError("party_full", "the party is full");
    const [row] = await tx
      .insert(schema.pokemon)
      .values({
        id: pokemon.identity.pokemonId,
        trainerId: trainer.id,
        identity: pokemon.identity,
        stats: pokemon.stats,
        state: pokemon.state,
        personality: pokemon.personality,
        memories: pokemon.memories,
        pokedex: pokemon.pokedex,
        inventory: pokemon.inventory,
        history: pokemon.history,
        slot,
        active: true,
        status: "home",
        modifiers: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(schema.event).values({
      pokemonId: row.id,
      ts: now,
      kind: "milestone",
      summary: `${trainer.displayName} chose me as their starter`,
      importance: 5,
      trainerId: trainer.id,
      emotion: "excited",
    });
    return row;
  });
}
