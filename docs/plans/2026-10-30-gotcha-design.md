# Gotcha, design and decision log

Written 2026-10-30. This is the source of truth for what the app is and why
it is shaped the way it is. Update it when a decision changes; leave the old
decision in the log with a note on what replaced it.

## What it is

A tamagotchi you install on your phone. Each member of the family is a
trainer. A trainer keeps up to six pokemon in a party, one of which is active
and on screen, and any number more in the PC. The active pokemon lives in a
small Minecraft-style diorama (a meadow, a cave, a beach) watched by a fixed
camera. It walks, swims or flies the way Cobblemon says that species moves,
plays the Cobblemon cry, uses the Cobblemon animations, and gets hungry,
bored, tired and dirty on a clock.

What makes it more than a Tamagotchi with a Pikachu skin is the brain. A
language model on the owner's NanoGPT subscription decides what the pokemon
does next, when it cries or emotes, how its personality shades its needs, and
what it says back when you talk to it through speech to text. PokeAPI and
Cobblemon's own species files supply the facts the brain reasons from:
habitat, diet, temperament, evolution.

Everything a pokemon is can be exported as one `.cpkmn` file and imported on
another install, which is how family members trade.

## Who it is for

One household behind Authelia. Four or five trainers. Phones first, desktop
tolerated. Nothing here is a product.

## Screens

1. **Home.** The whole screen is the diorama; the interface floats over it.
   See `docs/reference/home-screen.png`, the owner's concept render, which
   is the target. Top left: a card with the ball icon, name, level, gender
   and five hearts for health. Under it: four meters with pixel icons,
   Happiness, Hunger, Energy, Bond. Top right: a clock, date and weather
   widget, a camera button for photo mode, and a journal button with a
   badge when the pokemon has written something new. Bottom: five action
   buttons, Feed, Play, Groom, Rest, Items. A microphone button for talking
   sits with the actions. The pokemon stands in the foreground, large,
   with the scene falling off into depth behind it. Tapping the pokemon
   pets it; a dialogue box slides up when it has something to say.
2. **Care sheet.** Feed, Play, Groom, Rest open a sheet over the world with
   the relevant items from the bag. Items opens the bag itself. Medicine
   and discipline live inside Items and Rest.
3. **Party.** Six slots, drag to reorder, tap to make active. Swapping the
   active pokemon walks the old one off screen and the new one in.
4. **PC.** Boxes of thirty. Deposit, withdraw, release, export to `.cpkmn`,
   import from `.cpkmn`.
5. **Store.** Spend Bytes on berries, poffins, potions, toys, decorations and
   diorama unlocks.
6. **Mini-games.** A row of game cards. Each pays Bytes on a daily curve.
7. **Neighborhood.** Other trainers' active pokemon as read-only cards. Later:
   visit a friend's diorama and wave.
8. **Pokedex.** Every species seen, with the PokeAPI flavour text and the
   Cobblemon pokedex lines.
9. **Journal.** The pokemon's memories as a diary the trainer can read:
   the rolling summary on top, the episodic events below, written in the
   pokemon's voice. The badge on the Home screen lights when the nightly
   roll-up adds a page.
10. **Photo mode.** The camera button hides the HUD, lets the trainer nudge
    the camera a little, and saves a PNG of the canvas to the camera roll.
    Costs nothing, and it is how pokemon get shared in the family chat.

## Systems

### Needs

Six meters, 0 to 100, stored at `lastTickAt` and decayed forward on read.

| Need | Falls when | Fixed by |
|---|---|---|
| Hunger | always, faster after play | food items, berries the pokemon forages |
| Energy | awake, faster after play | sleeping (pokemon chooses, or lights off) |
| Hygiene | always, drops hard after a mess | groom |
| Fun | idle | play, mini-games, toys |
| Affection | not interacted with | petting, talking, being the active pokemon |
| Health | hunger or hygiene stay under 20, or while sick | potions, medicine, rest |

The HUD shows four of them as bars (Happiness is Fun, Bond is Affection)
and Health as hearts. Hygiene shows as dirt on the model and a bar inside
the Groom sheet, which is how a Tamagotchi shows it too.

Sickness is derived, not rolled. Health drains only while hunger or hygiene
sit under 20 or while already sick; sickness starts when health reaches 50
that way and worsens at 30 and 15. Medicine cures it, and so does eight hours
of unbroken sleep on a fed, clean pokemon. The engine has no random number
generator, which keeps every install deterministic and the tests honest.
`docs/balance.md` is generated from the engine and is the reference for how
fast all of this happens.

Decay rates are per species and per personality. The engine owns the base
rates in `constants.ts`. The brain may multiply them within a bounded range
(0.5x to 1.5x) as part of its personality, recorded in the pokemon file so
the pokemon decays the same on every install.

### Mood

Derived, never stored: a function of the needs, recent events, time of day,
and the species temperament. Mood picks the idle animation set and the emote
pool the brain can choose from.

### Growth

Level and experience follow the Cobblemon experience group for the species.
Experience comes from care, mini-games, and time spent as the active pokemon.
Friendship follows the Pokemon games' 0 to 255 scale. Evolution uses the
PokeAPI evolution chain. Level and friendship triggers are supported; item
and trade triggers are supported where the item exists in the store. The
pokemon asks before it evolves and the trainer can say no, forever or for
now.

### Bytes

The one currency. Earned by keeping meters above thresholds (a daily care
stipend), by mini-games on a diminishing daily curve, and by milestones
(level up, evolution, first time a need hits 100 after being under 20).
Spent in the store. No way to buy Bytes with money and no plan to add one.

### Store

Berries (cheap, species preferences matter), poffins and curry (big fills,
cost more), potions, toys (raise Fun decay resistance for a day), decorations
for the diorama, and diorama unlocks. Prices live with the balance constants.

### Mini-games

Touch-first, under 90 seconds, each a self-contained module that returns a
`MiniGameResult` the economy turns into Bytes and experience. Candidates for
the first set: berry catch, whack-a-Diglett, type-match memory, rhythm rock
smash, fishing. The active pokemon appears in the game where it makes sense.

### Dioramas

Voxel scenes built from a small block palette in the Minecraft style so the
Cobblemon models read correctly. The camera is fixed, low and close, a
little above the pokemon's eye line, with the pokemon in the foreground and
the scene running back to a far wall of trees or rock. Background blur and
a soft bloom sell the depth in the concept render; on a phone those come
from a cheap pass (a blurred baked backdrop plus one half-resolution
post-processing pass), not full-resolution depth of field. No orbit on
phones. Each diorama has a walkable navmesh, water
volumes, air volume, sleep spots, forage spots and a few interactive props.
First set: meadow, forest, beach, cave, snowfield, pond. Day and night follow
the real clock in the trainer's timezone.

The pokemon's habitat (from Cobblemon spawn data and PokeAPI habitat) sets
which dioramas it prefers and which it can visit at all. A Magikarp does not
go to the cave.

Each diorama has ambient wild pokemon as set dressing: a Butterfree over the
stream, a Pidgey on a rock. They use the same loader and idle clips, follow
simple scripted paths, have no brain and no needs, and are picked from the
species that spawn in that biome. The active pokemon can notice them (the
brain gets them as context) which is a cheap way to make the world feel
inhabited.

The clock and weather widget shows the trainer's local time. Weather is
real if the owner sets `OPEN_METEO_LAT` and `OPEN_METEO_LON` (Open-Meteo,
no key), and the diorama rains or snows to match; otherwise it is a clear
day.

### The brain

NanoGPT, OpenAI-compatible, through `@ai-sdk/openai-compatible`, same wiring
as kimigachi. The brain runs server-side on a cadence, not per frame:

- A **decision tick** every few minutes while a trainer is watching, every
  hour or so when nobody is. Input: current needs, mood, diorama, time, the
  rolling memory summary, recent events, the species facts. Output: a JSON
  plan the engine validates: the next activity, an optional emote, an optional
  line of dialogue, whether to cry.
- A **conversation turn** when the trainer speaks. Speech to text happens in
  the browser (Web Speech API) with a server Whisper fallback if the device
  lacks it. The pokemon answers in character. Pokemon do not speak English in
  the games, so the reply is a short translated gist shown in the dialogue
  box plus an animation and cry, not a paragraph.
- A **memory roll-up** nightly that condenses the day's events into the
  summary and extracts relationship notes per trainer.

Budget: one cheap model for ticks, a better one for conversation, hard daily
caps per pokemon, and a rules-only mode when the cap is hit. The engine
decays and eats regardless; the model only chooses among options the engine
offers.

### Multi-user

Authelia fronts the app and passes `Remote-User`. The first request from a
new user creates a trainer. Trainers see their own party, PC and bag, and
everybody's active pokemon on the Neighborhood screen. Trades go through
`.cpkmn` export and import even between trainers on the same install, so the
format is the one path and gets exercised constantly.

### The pokemon file

See `docs/cpkmn-format.md`. In short, a zip with a manifest, identity, stats,
state, personality, memories, pokedex snapshot, history, and the Cobblemon
assets either embedded or referenced by hash. Signed by the exporting install.

## Decisions

**Next.js 16 single pod, not Vite plus Fastify.** Kimigachi and Pet already
run this way on the cluster and the deploy path is known. The world is a
client component loaded dynamically; live updates use server-sent events.
WebSockets would be nicer for the Neighborhood but are not needed for one
family.

**Postgres, not SQLite.** Multi-user with concurrent writers from several
phones, nightly roll-ups, and a trade lock table. Pet's SQLite is fine for
one user; this is not one user.

**Cobblemon assets stay out of the repo.** Cobblemon's code is MPL 2.0 but
its models, textures, animations and sounds carry their own license that is
not a redistribution license. The owner drops the Cobblemon mod jar at
`assets/cobblemon/cobblemon.jar` (gitignored) and `pnpm assets:extract`
builds the runtime bundle into `.cobblemon-cache/`. Docker builds mount the
jar as a build secret or the pod extracts on first start from a PVC.

**Bedrock models rendered natively, not pre-converted to glTF.** Cobblemon
ships Bedrock `.geo.json` geometry and `.animation.json` clips. A loader that
turns those into three.js groups, box geometries with per-face UVs and
`AnimationClip`s keeps the pipeline one step and lets a `.cpkmn` carry the
original files. A glTF cache can be added later for load time if needed.
Molang expressions in animations are evaluated by a small interpreter that
covers the subset Cobblemon uses; unsupported expressions fall back to the
keyframe's static value and log once.

**Rules first, model second.** The LLM never writes a stat and never has the
last word on whether something is allowed. It chooses from a menu the engine
prepared. This keeps the game fair across trainers, keeps the pokemon alive
when the subscription hiccups, and makes the sim testable.

**Stasis in the file.** Time spent exported does not decay the pokemon. A
trade that sits in a chat for a week should not arrive sick. The importing
install sets `lastTickAt` to import time.

**Identity from Authelia, no login screen.** The cluster already has SSO and
the family already has accounts. Building passwords twice is a waste.

**Speech to text in the browser first.** Free, private, and works on iOS and
Android. A server Whisper route exists for devices that lack it, behind the
same `transcribe()` function.

**Pixel UI from licensed fonts.** Minecraft's own font is not redistributable.
Monocraft (OFL) for the Minecraft feel, Press Start 2P for headings.

**Particle effects are interpreted, not baked.** Cobblemon attaches Bedrock
particle definitions to clips (Gastly's gas, Slugma's lava bubbles, cherry
Torterra's petals, Chinchou's sparks). The extractor copies the definitions
and sprite sheets the pokemon animations name into
`.cobblemon-cache/particles/` as its own additive step with its own index,
so a built cache gains them on the next rollout without a re-extract. The
renderer reads the component subset those effects use (steady, instant,
once, looping and expression emitters; point, sphere, disc and box shapes;
flipbook and static UVs; gradient tint; speed, spin, acceleration, drag;
linear curves) and warns once per component it ignores. One instanced quad
mesh per blend mode per creature, sharing one atlas, so a species' effects
cost at most two draw calls. `size` is read as a half-extent, the Java
`quadSize` convention; read as a full width Slugma's bubbles vanished and the
petals were a pixel.

**Deployment specifics stay out of this repo.** The host, registry, namespace
and manifest numbers live in the owner's private cluster repo, which the
`k3s-deploy` agent reads. Nothing in this public repo names the owner's
network.

## Milestones

1. **Skeleton.** Next.js app, Drizzle schema, Authelia identity, trainer and
   party routes, pure sim engine with tests, one diorama with a placeholder
   cube that walks. `.cpkmn` pack and unpack with round-trip tests.
2. **Real pokemon.** Asset extraction, Bedrock loader, animations, cries,
   species behaviour driving movement, three dioramas.
3. **Care loop.** Needs on screen, care menu, store, Bytes, sleep, sickness,
   growth, evolution.
4. **Brain.** Decision ticks, emotes, conversation, nightly memory roll-up,
   budget caps.
5. **Family.** Neighborhood, trades through `.cpkmn`, Pokedex.
6. **Mini-games.** First three games.
7. **Deploy.** Dockerfile, manifests, Postgres, backups, ingress.

## Open questions

- Does NanoGPT expose a speech to text endpoint on the subscription? If so
  the Whisper fallback can point there instead of a self-hosted model.
- How much of Cobblemon's Molang does the animation set actually use? Survey
  during milestone 2 before writing the interpreter.
- Does Open-Meteo weather earn its place, or is it a toggle nobody turns on?
- Should pokemon from different trainers be able to meet in one diorama?
  Fun, but doubles the brain cost. Decide after milestone 5.
