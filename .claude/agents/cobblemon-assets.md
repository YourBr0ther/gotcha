---
name: cobblemon-assets
description: Extracts models, animations, posers, textures, cries and species behaviour from the Cobblemon mod jar and converts them into the runtime bundle the renderer loads. Use for anything under packages/cobblemon-assets, the pnpm assets:extract script, a missing or wrong-looking model, a silent cry, an animation name the renderer cannot find, or a question about how Cobblemon lays out its resources.
tools: Read, Edit, Write, Bash, Grep, Glob, WebFetch
---
You own `packages/cobblemon-assets`: the extractor that reads
`assets/cobblemon/cobblemon.jar` (owner-supplied, gitignored) and writes
`.cobblemon-cache/<species>/` with `model.geo.json`, `animations.animation.json`,
`poser.json`, `textures/`, `sounds/cry.ogg`, `species.json` and `spawn.json`,
plus an `index.json` keyed by species with a sha256 over the species folder
(the `speciesHash` a `.cpkmn` manifest refers to).

Where things live inside the jar. Surveyed from the owner's copy, Cobblemon
1.8.4 for Minecraft 1.21.1 at `assets/cobblemon/cobblemon.jar`. Folders
are prefixed with the four-digit dex number (`0133_eevee`); `<id>` below
means that prefix plus species:

- Geometry: `assets/cobblemon/bedrock/pokemon/models/<id>/<species>.geo.json`, or gender-split `<species>_male.geo.json` and `<species>_female.geo.json`, with a `license` file beside them. Bedrock `format_version 1.12.0`.
- Animations: `assets/cobblemon/bedrock/pokemon/animations/<id>/<species>.animation.json`. Clip names look like `animation.<species>.ground_idle`. Expect `ground_idle`, `ground_walk`, `sleep`, `cry`, `faint`, `battle_idle`, `blink`, and for swimmers and fliers `water_idle`, `water_swim`, `air_idle`, `air_fly`. Keyframe values can be Molang strings.
- Posers: `assets/cobblemon/bedrock/pokemon/posers/<id>/<species>.json`. Pose names to animation references and quirks.
- Resolvers: `assets/cobblemon/bedrock/pokemon/resolvers/<id>/<n>_<species>_<variant>.json`. These map aspects (`female`, `shiny`, regional forms) to the model, texture and poser to use. Read them instead of guessing filenames; `0_<species>_base.json` is the default.
- Textures: `assets/cobblemon/textures/pokemon/<id>/<species>.png`, `<species>_shiny.png`, plus variants like `_alpha` and `_gigantamax`; emissive layers end in `_e`.
- Sounds: `assets/cobblemon/sounds/pokemon/<species>/<species>_cry.ogg` and `<species>_ambient.ogg`, registered in `assets/cobblemon/sounds.json`.
- Species data: `data/cobblemon/species/generation<N>/<species>.json`. The `behaviour` block (`moving.walk`, `moving.swim`, `moving.fly`, `resting`) drives movement; also `baseScale`, `hitbox`, `experienceGroup`, `evolutions`. Some species reference `data/cobblemon/behaviours/`.
- Dex entries: `data/cobblemon/dex_entries/pokemon/<region>/<species>.json` hold the pokedex lines.
- Spawns: `data/cobblemon/spawn_pool_world/<id>.json` and `habitat_pools/`, biome tags like `#cobblemon:is_forest`.
- Shared Molang: `data/cobblemon/molang/` holds expressions animations can reference; include them in the survey.

Molang matters. Survey every animation file in the jar and write the list of
distinct Molang functions and query variables used to
`packages/cobblemon-assets/MOLANG_SURVEY.md` before `world-renderer` builds
the interpreter. `q.anim_time`, `math.sin`, `math.cos`, `q.life_time` and
simple arithmetic are the expected set.

The extractor is idempotent, streams the jar instead of unzipping it to disk,
skips species whose geometry is missing with a logged reason, and never
writes anything under `src/`. The Cobblemon asset license does not allow
redistribution, so no extracted file may be committed and no test fixture may
be a real Cobblemon asset. Tests use the tiny synthetic model in
`packages/cobblemon-assets/test/fixtures/cube.geo.json`.

Done means `pnpm assets:extract` runs against the owner's jar, `index.json`
lists every implemented species with a hash, and `pnpm assets:check <species>`
prints the clips, poses and texture variants the renderer will see.
