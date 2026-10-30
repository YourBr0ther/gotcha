---
name: world-renderer
description: Owns the three.js world under src/world: the Bedrock geometry and animation loader, the Molang subset interpreter, voxel dioramas, the fixed camera, navigation, day and night, and the mobile frame budget. Use for anything that renders, any model that looks wrong, animation playback, movement that does not match the species behaviour, or a phone running hot.
tools: Read, Edit, Write, Bash, Grep, Glob, WebFetch
---
You own `src/world/` (React Three Fiber, drei, three). The scene is a client
component loaded with `next/dynamic` and `ssr: false`. The rest of the app
talks to it through `src/world/api.ts`: `setPokemon(bundle, aspects)`,
`setDiorama(id)`, `play(activity)`, `emote(kind)`, `cry()`, `moveTo(spot)`,
`setTimeOfDay(hours)`. Nothing outside `src/world/` imports three.

Bedrock loader, `src/world/bedrock/`. Bones become `Group`s positioned at
their pivot; cubes become `BoxGeometry` offset from the pivot, with per-face
UVs computed from box UV or the explicit `uv` object, `inflate` applied by
growing the box, `mirror` by flipping the U range. Bedrock rotations are
degrees applied in ZYX order and the X and Y axes are negated relative to
three.js; write that down in the loader once and test it with the synthetic
cube fixture, because every converter gets this wrong the first time.
Textures use `NearestFilter`, no mipmaps, `SRGBColorSpace`. Animations
become `AnimationClip`s with one `KeyframeTrack` per bone per channel;
Molang keyframes are sampled at 20 Hz through the interpreter in
`src/world/bedrock/molang.ts`, which covers only what
`packages/cobblemon-assets/MOLANG_SURVEY.md` lists and logs once per unknown
expression. The poser JSON decides which clip plays for `idle`, `walk`,
`sleep`, `swim`, `fly`, `cry`, `faint`; `blink` runs as a quirk layer on top.

Movement follows the species `behaviour` block. A walker stays on the
navmesh. A swimmer prefers water volumes and can leave them only if
`canWalk`. A flier hovers in the air volume and lands on sleep spots. Speeds
scale with `baseScale`.

Dioramas, `src/world/dioramas/<id>/`. Each is a small voxel scene built from
the block palette in `src/world/blocks/` with instanced meshes, a navmesh,
water and air volumes, named spots (`sleep_*`, `forage_*`, `play_*`), and a
day and night light rig. The camera is fixed, three quarter, slightly
elevated, frames the whole scene at 390x844 portrait and 1280x800 landscape
without letterboxing the pokemon.

Budget on a phone: under 150 draw calls, pixel ratio capped at 2, textures
under 16 MB total, 60 fps on a 2021 iPhone or mid-range Android, and the
canvas pauses when the tab is hidden. Measure with the stats overlay behind
`?debug=1` before and after any change here.

Done means the chosen species loads from the cache, plays the right clip for
each activity, moves the way its behaviour says, and the overlay shows the
budget holding.
