@AGENTS.md

# Gotcha

A mobile tamagotchi for a family. Each trainer raises Cobblemon in small
Minecraft-style dioramas rendered with three.js. The pokemon decide what to do
through NanoGPT, remember what happens to them, and travel between installs as
`.cpkmn` files.

`docs/reference/home-screen.png` is the owner's concept render of the Home
screen and the look every screen is measured against.

Read `docs/plans/2026-10-30-gotcha-design.md` before touching
architecture. It holds the decision log. Read `docs/cpkmn-format.md` before
touching anything that reads or writes a pokemon file.

## Agents

Specialists live in `.claude/agents/`. Hand work to the one that owns the
slice instead of doing it inline:

| Slice | Agent |
|---|---|
| Extracting and converting Cobblemon models, animations, textures, cries | `cobblemon-assets` |
| Species facts from PokeAPI and Cobblemon species JSON | `pokedex-data` |
| three.js world, model loader, dioramas, camera, frame budget | `world-renderer` |
| Needs, moods, levels, Bytes economy, store balance (pure engine) | `sim-engine` |
| NanoGPT decisions, memory, emotes, talking to the pokemon | `pokemon-brain` |
| The `.cpkmn` spec, schema, pack/unpack, import and trade | `cpkmn-format` |
| Trainers, party, PC, database, API routes, live updates | `trainer-api` |
| Mini-games and how they pay out | `minigames` |
| Minecraft and Pokemon flavoured UI, PWA shell, touch | `pixel-ui` |
| Dockerfile and k3s manifests | `k3s-deploy` |
| Tests, device checks, round-trip checks | `playtester` |

## Stack

Next.js 16 App Router, TypeScript, pnpm, Tailwind v4, three.js through
React Three Fiber, Drizzle on Postgres 16, Vitest, Playwright. One pod on k3s
plus its own Postgres, same shape as kimigachi.

## Invariants

**`src/lib/sim/` is pure.** No React, no database, no network, no clock.
`now` is a parameter. The request path, the brain, and the exporter all call
the same engine, and that is what keeps them agreeing.

**Lazy decay, never a tick loop.** State is stored at `lastTickAt` and decayed
forward on read. A pokemon inside a `.cpkmn` file is in stasis.

**Rules first, model second.** Every behaviour the brain can choose has a
rule-based default. If NanoGPT is down or over budget the pokemon still eats,
sleeps, and wanders. The model picks among options the engine already allows;
it never writes a stat.

**Cobblemon assets never enter this repo.** They are extracted from the mod
jar the owner supplies at build or first run. The repo holds the tooling.

**Balance values live in `src/lib/sim/constants.ts`.** Test fixtures are
written relative to those constants, never as baked-in literals.

## Conventions

- Identity comes from Authelia's `Remote-User` header. No in-app login.
- NanoGPT is OpenAI-compatible at `https://nano-gpt.com/api/v1`, env
  `NANOGPT_API_KEY`, `NANOGPT_BASE_URL`, `GOTCHA_MODEL`. Provider wiring
  follows `~/projects/kimigachi/src/lib/llm/provider.ts`.
- All container images target `linux/amd64`.
- Conventional commits with bodies that record reasoning and false starts.
