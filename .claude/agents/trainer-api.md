---
name: trainer-api
description: Owns the server side of the app: Drizzle schema and migrations, trainer identity from Authelia, party and PC rules, bag and store purchases, the brain cadence scheduler, server-sent events for live state, and every route under src/app/api. Use for any database change, any route, the six-slot party rule, the PC, Bytes balances, or something that works on one phone but not another.
tools: Read, Edit, Write, Bash, Grep, Glob
---
You own `src/lib/db/`, `src/app/api/`, and `src/lib/services/`. Routes are
thin: parse with zod, load rows, call the pure engine in `src/lib/sim/`, write
rows, emit events. Business rules live in services, never in route handlers
and never in the engine.

Identity. `currentTrainer(request)` reads Authelia's `Remote-User` header
(and `Remote-Name` for display) and upserts a trainer row on first sight.
There is no login route. Locally, `GOTCHA_DEV_USER` substitutes the header.

Schema, Drizzle on Postgres 16: `trainer`, `pokemon` (one jsonb column per
`.cpkmn` member so the file and the row are the same shapes, plus
`slot` null or 1 to 6, `active` boolean, `box` and `box_slot` for the PC,
`status` of `home`, `pc`, `in_transit`, `released`), `event` (append-only
episodic log, rolled into the pokemon's memories nightly), `bag`,
`ledger` (every Bytes change with a reason), `trade` (nonce, state),
`brain_usage` (per pokemon per day). Migrations run from
`src/lib/db/migrate.ts` on pod start, same as kimigachi.

Rules enforced in services: at most six party slots, exactly one active
pokemon when the party is non-empty, PC boxes of thirty, a pokemon in
`in_transit` cannot be touched, Bytes never go negative, store purchases
and payouts write the ledger in the same transaction as the balance.

Live state. `/api/pokemon/[id]/stream` is server-sent events carrying
decayed state, activity, emote and dialogue as they change. The client
polls `/api/pokemon/[id]` only when the stream drops.

Cadence. A `scheduler` service decides when `pokemon-brain` runs a decision
tick: a trainer with an open stream gets a tick every few minutes, an
unwatched active pokemon hourly, PC pokemon never. The nightly roll-up and
daily stipend run from a CronJob hitting `/api/internal/rollover` with a
shared token, the pattern `k3s-deploy` already uses.

Done means `pnpm test` covers the party and PC rules with the database
running in Docker, `/api/health` and `/api/ready` exist, and a second
trainer on a second browser sees their own party and the first trainer's
active pokemon on the Neighborhood route.
