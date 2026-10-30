# The brain

How a pokemon decides what to do, answers its trainer, and remembers the
day. Code lives in `src/lib/brain/`. The engine in `src/lib/sim/` stays pure;
the brain only ever picks from options the engine already allows, and it
never writes a need, a level or a Byte.

## Entry points

| Call | When | Model | Budget kind |
|---|---|---|---|
| `decideTick(input)` | scheduler cadence: every 3 minutes while a stream is open, hourly otherwise | `GOTCHA_MODEL_TICK` | `tick` |
| `converse(input, text)` / `talkTo(db, trainer, id, text)` | the trainer speaks | `GOTCHA_MODEL_TALK` | `talk` |
| `rollupDay(input)` | nightly roll-over, once per pokemon with unrolled events | `GOTCHA_MODEL_TALK` | `talk` |
| `createPersonality(facts, seed)` | hatch, inside `buildStarter` | none (rules only) | none |
| `enrichVoice(personality, facts)` | hatch, inside `createStarter`, only with a key | `GOTCHA_MODEL_TALK` | none (one call, no row yet) |

`src/lib/services/brain-hook.ts` wires the first and third into the
scheduler and the roll-over. `brainTick` always returns a plan: by model
when the key and the budget allow, by rules otherwise. The result carries
`source: "model" | "rules"` so the stream can show which one answered.

## What a tick does

1. Build the context from the row and the decayed view: species facts from
   the frozen `pokedex` member, personality, state and mood, the trainer's
   local time, `memories.summary`, the last 10 event rows, and the
   relationship with the owning trainer.
2. Build the menu. Activities are `idle`, `walk`, `sleep`, `swim`, `fly`,
   the same names the world's poser plays. `sleep` is offered when energy is
   under `SLEEPY_ENERGY` or it is the trainer's night, and only under the
   engine's rest gate (`CARE.rest.refuseEnergy`). `swim` needs a diorama
   with water (`DIORAMA_FACTS`) and a species whose Cobblemon behaviour says
   it swims and does not avoid water. `fly` needs `canFly`. Asleep means
   the menu is `sleep` alone. Emotes come from `EMOTE_POOLS[mood.label]`.
   `canMisbehave` is true when awake, not sick, and fun or affection is low.
3. Ask the model inside `withBudget`, parse with the zod schema, then check
   the answer against the menu. An activity or emote that was not offered
   throws the whole answer away and the rules decide (`reason: "rejected"`).
   A line over 80 characters is clipped at a word boundary.
4. Write what the plan implies. A line becomes a `talk` event when someone
   is watching, an `other` event when nobody is. `misbehaving: true` sets
   `state.flags.misbehaving` through a jsonb merge, which the discipline
   action clears. The activity is recorded on `state.activity`. Choosing
   `sleep` puts the pokemon to sleep through the same gate the rest action
   uses, with a `fell_asleep` event and no experience or friendship.
5. Publish a `brain` message on the bus. The scheduler hook turns this off
   and publishes the result itself so watchers get one message, not two.

## Prompt layout

Every prompt is XML-tagged blocks in this order, from `BLOCK_ORDER` in
`prompts.ts`:

```
<species_facts>   types, habitat, two flavour texts, two Cobblemon lines, behaviour summary
<personality>     traits, temperament, likes, dislikes, food preferences, voice, quirks
<state>           the engine's numbers for this moment, mood, asleep, sick, misbehaving
<location_time>   diorama description, spot, local hour and period, date
<memory_summary>  memories.summary
<recent_events>   last 10 events, oldest first
<relationship>    the present trainer, what the pokemon calls them, bond, notes
<menu>            allowed activities, allowed emotes, whether misbehaving is on offer
<output_schema>   the JSON shape in words
```

The conversation prompt adds `<trainer_said>` between `<menu>` and
`<output_schema>`. The roll-up prompt is shorter: species, personality,
the old summary, `<day_events>`, the relationship, and its own schema.

The system prompt names the pokemon and its species, says it cannot speak
human language, and tells it that a `line` is the gist of a cry in its own
voice. The state block is restated every turn so the model is never asked
to remember a number.

## Output schemas

Tick: `{ activity, emote?, line?, cry, misbehaving? }`.
Talk: `{ line, emote, cry, activity?, importance: 1..3 }`. The importance
goes on the `talk` event row.
Roll-up: `{ summary, callsThem?, notes: string[] (0..3), bondDelta: -5..5 }`.
Voice at hatch: `{ chatter, quirk }`.

## Rules fallback

`rules.ts` answers every call the model might not. `rulesTick` sleeps when
exhausted or at night with low energy, paces when hungry or bored, and
otherwise idles, walks, or takes a swim or a flight when offered. Emotes
come from the mood's pool more often when the mood is low. A pokemon with a
mischievous, stubborn, greedy, naughty or bold trait sometimes starts
misbehaving when the menu allows it. `rulesReply` has two canned gists per
mood label. Choices are seeded by `personality.promptSeed` and the current
minute, so two installs with the same file agree.

The roll-up without a model joins the day's events in order of importance
behind a dated heading, keeps the previous summary behind that (today gets
at most 60 percent of the space), and stays under 2,000 characters.

## Budgets

`budget.ts` keeps one `brain_usage` row per pokemon per UTC day. The caps
are in `src/lib/brain/constants.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `TICK_CALLS_PER_DAY` | 200 | ten hours of a watched pokemon at one tick every three minutes |
| `TALK_CALLS_PER_DAY` | 80 | conversation turns plus the nightly roll-up |
| `TOKENS_PER_DAY` | 400,000 | prompt and completion tokens, all kinds together |
| `BRAIN_TIMEOUT_MS` | 8,000 | a slower call loses to the rules |

`withBudget(db, pokemonId, kind, fn)` refuses when `NANOGPT_API_KEY` is
missing (`reason: "unconfigured"`), reserves the call with a guarded
increment before running it (`reason: "cap"` when the increment finds no
room), aborts at the timeout (`reason: "timeout"`), and adds the tokens the
SDK reports afterwards. Any thrown error is `reason: "error"`. The caller
then uses the rules and tags the result `source: "rules"`.

## Environment

| Variable | Default | Used by |
|---|---|---|
| `NANOGPT_API_KEY` | none; everything runs by rules without it | provider, STT |
| `NANOGPT_BASE_URL` | `https://nano-gpt.com/api/v1` | provider, STT |
| `GOTCHA_MODEL_TICK` | `GOTCHA_MODEL`, then `zai-org/glm-5.2` | decision ticks |
| `GOTCHA_MODEL_TALK` | `GOTCHA_MODEL`, then `zai-org/glm-5.2` | conversation, roll-up, voice |
| `GOTCHA_MODEL` | `zai-org/glm-5.2` | fallback for both |
| `GOTCHA_STT_URL` | `NANOGPT_BASE_URL` + `/audio/transcriptions` | `/api/transcribe` |
| `GOTCHA_STT_MODEL` | `whisper-1` | `/api/transcribe` |

The provider is built lazily, so importing any brain module never reads
the environment. Any model id containing `glm` gets
`chat_template_kwargs.enable_thinking: false` in the request body; GLM on
NanoGPT otherwise writes its reasoning into the content and the JSON
parse fails. There are no temperature, top_p or penalty overrides
anywhere, on purpose.

## Routes

`POST /api/pokemon/{id}/talk` with `{ "text": "..." }` (1 to 500
characters). Answers `{ line, emote, cry, activity?, source, reason? }`.
Only the owner can talk to a pokemon (anyone else gets 404), a pokemon out
for trade answers 409 `in_transit`, one in the PC answers 409 `not_home`.
Each turn logs a `talk` event and adds one point of bond with the trainer.

`POST /api/transcribe` with multipart `file` (webm, ogg, wav, mp3, m4a) or
the raw audio body with an audio content type. Answers `{ text }`, or 501
`{ error, code: "stt_unavailable" }` when there is no backend, so the client
offers typing instead. An endpoint that answers 404, 405 or 501 is
remembered as absent for ten minutes.

On the client, `transcribe(record?)` in `stt.ts` tries the Web Speech API
first and resolves null when the browser has none; with a `record` callback
it posts the recording to the route. `transcribeInBrowser()` alone resolves
null when the API is missing.

## Memory

The nightly roll-up rewrites `memories.summary` under 2,000 characters,
appends the day's event rows to `memories.episodic` (trimmed with
`trimEpisodic`, so the newest 500 plus everything with importance 3 or more
survive), and updates `memories.relationships[trainerId]`: bond 0..100,
`callsThem`, up to ten notes, `lastSeenAt`. Without a model the bond moves
by one per care or play, two per milestone, minus one per neglect and
minus two per care mistake, within eight points a day.

It also inserts one journal page per day as an event row: kind `other`,
emotion `reflective`, `rolledUp` already true, summary `Journal, YYYY-MM-DD:
...` within 280 characters. The Journal screen shows `memories.summary` on
top and the episodic list below; the badge can key off the newest journal
row.

## Personality

`createPersonality(facts, seed)` is seeded by `promptSeed`, so the same
seed gives the same pokemon on any install. It picks two to four traits
with one drawn from the species' first type, a temperament biased by type,
three likes and dislikes, three berry preferences keyed by store ids (one
favourite around 1.5, one liked, one disliked around 0.6), decay
multipliers multiplied together from the traits and clamped to 0.5..1.5
with health fixed at 1, a chatter line built from a cry syllable of the
species name, and one quirk. With a key, `enrichVoice` lets the talk model
rewrite the chatter and add one quirk; nothing the engine reads changes.

## Tests

`pnpm vitest run src/lib/brain` needs the local Postgres from
`docker-compose.dev.yml` and the extracted Cobblemon cache, like the
service tests. No test touches the network: model calls go through an
injected `generate` function or `MockLanguageModelV3` from `ai/test`, and
the STT tests pass a fake `fetch`. Recorded answers are in
`src/lib/brain/test/fixtures/`.
