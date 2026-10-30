# The `.cpkmn` file

One file that is the whole pokemon. Model, textures, animations, cry,
identity, stats, needs, personality, memories, history. Export it from one
install, import it on another, and the same pokemon walks out of the box with
the same scars and the same opinion of you.

Version 1.0.0. The `cpkmn-format` agent owns this document, the schema at
`packages/cpkmn/schema/cpkmn.schema.json`, and the library in
`packages/cpkmn/`.

## Container

A `.cpkmn` is a ZIP archive. ZIP because the payload mixes JSON with PNG and
OGG, every platform can open it, and it streams. Rules borrowed from EPUB so
the file is identifiable without a parser:

- The first entry is named `mimetype`, stored uncompressed, containing exactly
  `application/vnd.gotcha.cpkmn` with no trailing newline. The
  first 38 bytes of any `.cpkmn` are therefore the ZIP local header followed
  by that string, which is the magic.
- Every other entry is deflate-compressed, except `assets/**` which is
  stored (PNG and OGG are already compressed).
- Entry names are forward-slash, UTF-8, no leading slash, no `..`.
- `manifest.json` is the second entry. The JSON members follow in the order
  of the Layout below, then `assets/**` sorted by path.
- JSON members are written as two-space indented JSON with a trailing
  newline, known fields first and preserved unknown fields after. Every
  entry's timestamp is `exportedAt`, so the same pokemon packed with the
  same clock gives the same bytes.

Media type `application/vnd.gotcha.cpkmn`. Suggested size: under
8 MB embedded, under 200 KB referenced. A reader treats a wrong entry order
or compression method as a warning, not corruption; the entry name rules are
enforced.

## Layout

```
mimetype
manifest.json           format version, content hashes, signature
identity.json           who this pokemon is
stats.json              level, experience, IVs, EVs, moves, friendship
state.json              needs at lastTickAt, status conditions, flags
personality.json        traits, likes, decay multipliers, voice
memories/
  summary.md            rolling narrative the brain reads every tick
  episodic.jsonl        one event per line, newest last
  relationships.json    per-trainer bond notes
pokedex.json            species snapshot from PokeAPI and Cobblemon
inventory.json          held item, worn cosmetics
history.json            origin, every trainer, trades, milestones
trade.json              present only on a file exported for trade
assets/                 present when assetMode is "embedded"
  model.geo.json
  animations.animation.json
  poser.json
  textures/base.png
  textures/shiny.png            optional
  textures/emissive.png         optional
  sounds/cry.ogg
  sounds.json
```

Every JSON member validates against its `$defs` entry in the schema. Unknown
top-level keys in any member are preserved on import and written back on
export, so a newer install can add fields without an older one dropping them.

## manifest.json

```json
{
  "format": "cpkmn",
  "formatVersion": "1.0.0",
  "generator": { "name": "gotcha", "version": "0.1.0" },
  "pokemonId": "0192a8f4-6c3e-7d8a-b4e1-9f2c1b3a5d7e",
  "createdAt": "2026-10-30T15:04:05Z",
  "exportedAt": "2026-11-02T20:11:00Z",
  "assetMode": "embedded",
  "assetPack": { "cobblemonVersion": "1.6.1", "speciesHash": "sha256:..." },
  "contents": {
    "identity.json": { "sha256": "...", "bytes": 412 },
    "assets/model.geo.json": { "sha256": "...", "bytes": 38210 }
  },
  "signature": {
    "alg": "ed25519",
    "keyId": "my-install#2026-10",
    "signedAt": "2026-11-02T20:11:00Z",
    "value": "base64..."
  }
}
```

`contents` lists every entry except `mimetype` and `manifest.json`. The
signature is over the canonical JSON (RFC 8785) of `pokemonId`, `exportedAt`,
`assetMode` and `contents`, UTF-8 encoded, signed with ed25519; `signedAt`
equals `exportedAt`. An install publishes its public key at
`/.well-known/cpkmn-keys.json` as
`{ "keys": [{ "keyId": "my-install#2026-10", "alg": "ed25519", "publicKey": "base64" }] }`;
`scripts/keygen.ts` prints a keypair in that shape. An importer that knows
the key marks the import `verified`; one that does not, or whose check fails,
marks it `unverified` in `history.json` and says so in the UI. A file with no
`signature` block is `unsigned`. There is no central authority, so a determined person
can duplicate a pokemon across two installs. Within one install the trade
lock below prevents it.

`assetMode` is `embedded` or `reference`. Reference mode omits `assets/` and
relies on `assetPack.speciesHash` matching the importer's extracted Cobblemon
pack. Use reference for backups and same-install trades, embedded for
anything leaving the house.

## identity.json

The parts that never change after creation except nickname and the trainer
that owns it.

```json
{
  "pokemonId": "0192a8f4-...",
  "species": "pikachu",
  "nationalDex": 25,
  "form": "normal",
  "aspects": ["shiny"],
  "nickname": "Sparky",
  "gender": "female",
  "shiny": true,
  "nature": "jolly",
  "ability": "static",
  "hiddenAbility": false,
  "ballType": "poke_ball",
  "originalTrainer": { "trainerId": "...", "name": "Eli" },
  "currentTrainer": { "trainerId": "...", "name": "Eli" },
  "hatchedAt": "2026-10-30T15:04:05Z",
  "origin": "starter"
}
```

`species` and `form` use Cobblemon's identifiers so the asset pack resolves
directly. `aspects` is Cobblemon's own list (shiny, regional forms, gender
variants) and decides which texture and poser load. `origin` is one of
`starter`, `egg`, `gift`, `store`, `event`, `import`.

## stats.json

Pokemon-game numbers so a future battle feature or a PKHeX-style tool can
read them.

```json
{
  "level": 14,
  "experience": 3120,
  "experienceGroup": "medium_fast",
  "friendship": 142,
  "ivs": { "hp": 31, "atk": 20, "def": 14, "spa": 30, "spd": 9, "spe": 31 },
  "evs": { "hp": 0, "atk": 12, "def": 0, "spa": 0, "spd": 0, "spe": 40 },
  "moves": [
    { "id": "thunder_shock", "pp": 30, "maxPp": 30 },
    { "id": "quick_attack", "pp": 30, "maxPp": 30 }
  ],
  "weightKg": 6.2,
  "heightM": 0.4,
  "evolution": { "blocked": false, "declinedUntil": null, "stage": 1 }
}
```

## state.json

The live simulation snapshot. Values are as of `lastTickAt`; the importer
sets `lastTickAt` to import time (stasis), then decays normally.

```json
{
  "lastTickAt": "2026-11-02T20:11:00Z",
  "needs": { "hunger": 72, "energy": 40, "hygiene": 88, "fun": 55, "affection": 90, "health": 100 },
  "status": [],
  "asleep": false,
  "sleepStartedAt": null,
  "lastMessAt": "2026-11-02T14:00:00Z",
  "sickness": null,
  "location": { "diorama": "meadow", "spot": "forage_2" },
  "activity": "idle",
  "ageDays": 3.2,
  "careMistakes": 1,
  "flags": { "hasEvolvedOnce": false, "metAllTrainers": true }
}
```

`status` uses Pokemon status ids (`poisoned`, `burned`, `paralyzed`,
`asleep` is not here, see `asleep`). `sickness` is `null` or
`{ "kind": "cold", "since": "...", "severity": 1 }`.

## personality.json

What the brain reads to be this pokemon and not another of the same
species. The engine reads only `decayMultipliers` and `preferences`.

```json
{
  "traits": ["curious", "greedy", "brave"],
  "temperament": "playful",
  "likes": ["oran_berry", "water", "thunderstorms"],
  "dislikes": ["baths", "being ignored"],
  "preferences": { "dioramas": ["meadow", "forest"], "foods": { "oran_berry": 1.5, "chesto_berry": 0.6 } },
  "decayMultipliers": { "hunger": 1.3, "energy": 0.9, "hygiene": 1.0, "fun": 1.2, "affection": 1.1, "health": 1.0 },
  "voice": { "chatter": "short, lots of 'pika', tilts head", "quirks": ["sneezes when startled"] },
  "promptSeed": 814233
}
```

`decayMultipliers` are clamped to 0.5 to 1.5 on import. `promptSeed` keeps
the brain's random choices stable across installs.

## memories/

`summary.md` is the rolling narrative, under 2,000 characters, rewritten by
the nightly roll-up. `episodic.jsonl` is append-only, one JSON object per
line:

```json
{"ts":"2026-11-01T09:12:00Z","kind":"care","summary":"Eli fed me an oran berry while I was sulking","importance":2,"trainerId":"...","emotion":"grateful"}
{"ts":"2026-11-01T21:40:00Z","kind":"milestone","summary":"Reached level 14","importance":3}
```

`kind` is one of `care`, `play`, `talk`, `neglect`, `milestone`, `trade`,
`visit`, `sickness`, `evolution`, `other`. Exports keep the most recent 500
lines and everything with `importance` 3 or higher. `relationships.json` is
keyed by trainer id with `bond` 0 to 100, the name the pokemon uses for them,
and up to ten notes.

`episodic.jsonl` may hold entries newer than the last roll-up. An install
keeps the day's events in a log until the nightly roll-up folds them into
memories; the exporter appends the not-yet-rolled-up ones to the file as
ordinary episodic lines, newest last, so a backup taken on the pokemon's
first day is not empty. Those entries are not yet reflected in `summary.md`.
A reader does not tell them apart, and on an install that has never seen the
pokemon they are simply what it remembers. When the stored summary is empty
the exporter writes a one-paragraph stand-in from the rules, with no model:
`Hatched on <date>. <n> things have happened so far, most recently <last
event summary>.` (or `Nothing has happened yet.`).

## pokedex.json

A frozen snapshot of the species facts so the file reads the same even if
PokeAPI changes or is down: types, egg groups, habitat, generation, flavour
texts, Cobblemon pokedex lines, the behaviour block (`moving`, `resting`,
`idle`), base stats, evolution chain, and the `sourcedAt` timestamp.

## inventory.json and history.json

Inventory is the held item and worn cosmetics, both store item ids.

History is the audit trail. `origin` repeats the identity origin with
detail, `trainers` is every trainer in order with `from` and `to`
timestamps, `trades` is a list of `{ at, fromInstall, toInstall, verified }`,
`milestones` is a list of `{ at, kind, detail }` (`kind` is free text; the
importer writes `restored` when a released pokemon comes back from a backup,
see below), `imports` is every import with the verification result.

## trade.json

Present only when the exporter was asked to trade rather than back up.

```json
{ "nonce": "...", "fromTrainerId": "...", "toTrainerId": null, "offeredAt": "...", "expiresAt": "..." }
```

Importing a file whose `pokemonId` is `in_transit` on this install is only
accepted when the file carries the nonce of that pokemon's outstanding
trade. A trainer other than the owner must also present a file whose
signature verifies against a known key, and the offer must not have expired
or been addressed to someone else. The owner can always bring their own
pokemon home with the trade file, even unsigned. The once-per-trainer
welcome bonus on a new arrival is paid only for a verified file.

Exporting for trade sets the pokemon to `in_transit` on the source install.
It cannot be made active, fed, or exported again until the file is imported
back (which cancels the trade) or the trade is confirmed by the recipient
install calling back with the nonce, if both installs are reachable. If they
are not, the sender confirms manually and the row is released.

A released pokemon keeps its row, with status `released`, so its id is still
known to the install. Importing a file with that id restores it only when the
importer is the trainer who released it on this install. The file's
`currentTrainer` is never consulted: it is whatever the exporter wrote, and a
backup taken before a trade must not undo that trade. The restore writes the file's members over the row, sets
`lastTickAt` to the import time, places the pokemon in the first free party
slot or else the PC, and adds `{ "kind": "restored" }` to
`history.milestones`. Anyone else is refused unless the file carries a live
trade offer addressed to them, the same bar as an in_transit arrival. Log
rows the file already carries as episodic entries are marked rolled up on
any import of a known id, so the next roll-up does not record them twice.

## Versioning

`formatVersion` is semver. Patch: additive optional fields. Minor: new
members or new enum values, older readers keep working by preserving unknown
keys. Major: a migration in `packages/cpkmn/src/migrations/` and a note here.
Readers refuse files with a higher major than they know.

## Library contract

```ts
import { pack, unpack, verify, migrate, createSigner } from "@gotcha/cpkmn";

const signer = createSigner(process.env.CPKMN_SIGNING_KEY, process.env.CPKMN_SIGNING_KEY_ID);
const file: Uint8Array = await pack(pokemon, {
  assetMode: "embedded",          // "reference" also needs assetPack
  signer,                         // omit for an unsigned file
  generator: { name: "gotcha", version: "0.1.0" },
  now,                            // exportedAt; defaults to the clock
});
const { pokemon, manifest, verification, warnings } = await unpack(file, { knownKeys });
const { verification: v } = await verify(file, knownKeys);  // hashes and signature only
```

`knownKeys` maps `keyId` to base64 public key; `knownKeysFromKeyFile` turns
a fetched `/.well-known/cpkmn-keys.json` into that map.

`pack` validates every member against the schema and refuses to write a
file that would not open. It does not trim `episodic.jsonl`; an exporter
that wants the 500-line cut calls `trimEpisodic` first. `createdAt` defaults
to `identity.hatchedAt`.

`unpack` opens the zip, checks the `mimetype` entry, reads the manifest,
refuses a higher major, checks every hash before any member is parsed, then
checks the signature, migrates older versions, clamps the values the spec
says to clamp, validates every member and splits unknown top-level keys into
`pokemon.extra` (keyed by member, plus `manifest`). It throws `CpkmnError`
with a `code` for corruption: not a zip, wrong or missing `mimetype`, a
manifest that fails the schema, a hash or byte count that does not match, an
entry not listed in `contents`, a listed entry that is missing, an entry name
that breaks the rules, a member that fails the schema after clamping, or a
major it does not know. Everything else is a `Warning` with a `code`: an
unsigned or unverified signature, a clamp, unknown keys, a newer minor, a
wrong entry order or method, an episodic line that fails the schema
(dropped), a member it does not know (not carried), a missing embedded asset,
a summary over 2,000 characters.

`unpack` does not touch `state.lastTickAt`. Stasis is the importer's job: it
sets `lastTickAt` to the import time before saving.

`migrate(members, fromVersion)` lifts parsed members one major at a time
through `packages/cpkmn/src/migrations/`; same major is the identity. The
round-trip test packs, unpacks and deep-equals in both asset modes.
