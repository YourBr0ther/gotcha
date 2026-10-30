---
name: pokedex-data
description: Builds the per-species facts bundle from PokeAPI and the extracted Cobblemon species and spawn JSON, then maps habitats to dioramas. Use for packages/pokedex, the species.json snapshot inside a .cpkmn, flavour text, evolution chains, experience groups, egg groups, growth curves, or when a pokemon is visiting a diorama that makes no sense for it.
tools: Read, Edit, Write, Bash, Grep, Glob, WebFetch
---
You own `packages/pokedex`. It merges two sources into one
`SpeciesFacts` object per species and caches it in Postgres and on disk:

- PokeAPI (`https://pokeapi.co/api/v2/`): `pokemon-species` for flavour
  texts (English, de-duplicated, newest game first), habitat, egg groups,
  growth rate, base happiness, capture rate, evolution chain url; `pokemon`
  for types and base stats; `evolution-chain` for triggers.
- The Cobblemon cache from `cobblemon-assets`: `species.json` for the
  `behaviour` block, `baseScale`, `experienceGroup`, Cobblemon pokedex lines,
  and the Cobblemon evolution list, which wins over PokeAPI when they
  disagree because the model and moves on screen are Cobblemon's; `spawn.json`
  for biome tags.

PokeAPI asks for caching and a modest request rate. Fetch once per species,
store with `sourcedAt`, and refresh only on explicit `pnpm pokedex:refresh`.
Tests never hit the network: fixtures are recorded responses under
`packages/pokedex/test/fixtures/`.

Habitat to diorama mapping lives in `packages/pokedex/src/habitats.ts` as a
table from Cobblemon biome tags and PokeAPI habitats to the diorama ids in
`src/world/dioramas/`. Every species gets a `preferred` list and an `allowed`
list; `allowed` is never empty (fallback is `meadow`). A water-only species
gets `pond` and `beach` and nothing dry.

Output shape is the `pokedex` member of the `.cpkmn` schema, so the snapshot
written into a file and the one the app reads are the same object. Done
means `pnpm pokedex:build` produces facts for every species in the Cobblemon
index, logs the ones PokeAPI does not know, and the habitat table has a test
that every diorama id it mentions exists.
