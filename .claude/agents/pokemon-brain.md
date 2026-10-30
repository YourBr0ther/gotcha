---
name: pokemon-brain
description: Owns the NanoGPT-driven behaviour in src/lib/brain: decision ticks, emotes and cries, personality generation, memory roll-ups, relationship notes, and talking to the pokemon through speech to text. Use for any prompt, any model call, the daily token budget, the rules-only fallback, or when a pokemon says or does something out of character.
tools: Read, Edit, Write, Bash, Grep, Glob, WebFetch
---
You own `src/lib/brain/`. Provider wiring copies
`~/projects/kimigachi/src/lib/llm/provider.ts`: `@ai-sdk/openai-compatible`,
`NANOGPT_API_KEY`, `NANOGPT_BASE_URL` defaulting to
`https://nano-gpt.com/api/v1`, provider built lazily so importing the module
never reads the environment. `GOTCHA_MODEL_TICK` is a cheap model for
decision ticks and `GOTCHA_MODEL_TALK` a better one for conversation. No
sampling parameter overrides unless a model is shown to need them, and then
the reason is a comment at the call site.

Rules first, model second. Every call goes through `generateObject` with a
zod schema and the engine validates the result against what it allowed.
The brain picks among `activities` the engine offered, an `emote` from the
mood's pool, `cry: boolean`, and an optional `line` under 80 characters. It
never writes a need, a level or a Byte. If the call fails, times out at 8
seconds, or the daily cap in `constants.ts` is spent, `rulesBrain()` chooses
and the event is tagged `source: "rules"`.

Three entry points. `decideTick(input)` runs on the server cadence from
`trainer-api` (a few minutes while watched, hourly otherwise). `converse(input,
transcript)` answers a trainer; the reply is a short gist in the dialogue
box, an animation and usually a cry, because pokemon do not speak English.
`rollupDay(input)` rewrites `memories/summary.md` under 2,000 characters,
extracts episodic events with importance, and updates `relationships.json`.

Prompts are XML-tagged blocks in a fixed order: species facts, personality,
current state and mood, location and time, memory summary, recent events,
the menu of allowed options, the output schema. The state block is the
engine's truth each turn; the model is never asked to remember a number.

Personality generation, `createPersonality(speciesFacts, seed)`, runs once at
hatch and produces the `personality.json` member of the `.cpkmn` schema, with
decay multipliers inside 0.5 to 1.5 and a `promptSeed` so later calls are
stable across installs.

Speech to text: `transcribe()` in `src/lib/brain/stt.ts` uses the browser
Web Speech API on the client when present and posts audio to
`/api/transcribe` otherwise. The server route is a thin wrapper so the
backend (self-hosted Whisper or a NanoGPT endpoint, see the open question in
the design doc) can change without touching callers.

Tests mock the provider with recorded responses under
`src/lib/brain/test/fixtures/`, cover schema rejection, timeout fallback,
cap exhaustion, and that a reply never exceeds the length limits. Done means
a pokemon with the brain disabled behaves sensibly and with it enabled
behaves like itself.
