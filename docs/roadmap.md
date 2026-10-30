# Roadmap

Status as of 2026-10-30. Checked items are built, tested and on `main`.
Milestones follow the design doc; later sections are the plan, not a promise.

## Milestone 1, skeleton

- [x] Next.js 16 app, pnpm workspace, Vitest, Playwright
- [x] Pure simulation engine with lazy decay, six needs, mood, growth, Bytes economy, store catalog, generated balance table
- [x] `.cpkmn` file format: spec, JSON schema, pack, unpack, verify, migrate, ed25519 signing
- [x] Postgres schema and migrations, header identity, party and PC rules, care, store, stipend, rollover
- [x] Export and import with the trade lock, hardened against forged files and currency minting

## Milestone 2, real pokemon

- [x] Extractor for the Cobblemon jar: 903 species, Molang survey, synthesized posers for code-defined species
- [x] Bedrock geometry and animation loader, Molang interpreter, procedural walk, look and wing flap layers
- [x] Species facts from PokeAPI merged with Cobblemon data, evolution rules, habitat to diorama mapping
- [x] Six dioramas: meadow, forest, beach, cave, snowfield, pond
- [x] Swimmers, fliers and water-only species move the way their behaviour block says
- [x] Emissive textures, per-bone mesh merging, production asset route with immutable caching
- [x] Ambient wild pokemon per diorama
- [ ] Phone performance pass on a real iPhone and a mid-range Android
- [ ] Embedded asset mode in exports, so a file can leave an install that has a different Cobblemon version

## Milestone 3, care loop

- [x] Care actions: feed, play, groom, rest, wake, medicine, discipline, pet, with care mistakes
- [x] Sickness derived from neglect, cured by medicine or rest
- [x] Store, bag, Bytes ledger, daily stipend
- [x] Home screen from the concept render: floating HUD, action buttons, care sheets, dialogue box, photo mode
- [x] Party, PC, Store, Journal, Pokedex, Neighborhood screens
- [ ] Evolution prompt with the trainer's yes or no
- [x] PWA manifest, icons and service worker (install on a real phone still to be checked)

## Milestone 4, brain

- [x] NanoGPT decision ticks picking from an engine-approved menu, with a rules fallback
- [x] Talking to the pokemon with a short in-character reply, emote and cry
- [x] Nightly memory roll-up into a journal entry and a rolling summary
- [x] Generated personalities with bounded decay multipliers
- [x] Daily call and token budgets per pokemon
- [x] Transcribe route with a browser speech fallback
- [x] Voice recording in the app and the microphone button
- [ ] A cheaper tick model and a better talk model chosen per call

## Milestone 5, family

- [x] Neighborhood API: every trainer's active pokemon
- [x] Trades through `.cpkmn` files, verified against published install keys
- [x] Neighborhood screen
- [ ] Visiting a friend's diorama
- [ ] Key exchange between installs without copying JSON by hand
- [ ] Gifts and eggs as a second way to get pokemon

## Milestone 6, mini-games

- [x] Payout curve with a daily cap
- [ ] Berry catch, whack-a-Diglett, type-match memory
- [ ] Rhythm rock smash, fishing
- [ ] The active pokemon reacting to wins and losses

## Milestone 7, deploy

- [x] Dockerfile, linux/amd64 image (279 MB, verified running locally)
- [x] Generic k3s manifests: app, Postgres, data volume, rollover and backup CronJobs
- [ ] First deployment to the owner's cluster
- [x] First-run asset extraction and pokedex build from the data volume, readiness reports warming

## Later

- Real weather in the diorama from Open-Meteo
- Two trainers' pokemon meeting in one diorama
- Held items, cosmetics on the model, decorations placed in the diorama
- Battles, if they ever make sense for a tamagotchi
