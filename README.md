# Gotcha

Gotta catch, gotta care. A family tamagotchi for the phone. Each trainer raises Cobblemon in small
Minecraft-style dioramas rendered with three.js. The pokemon decide what to
do through NanoGPT, remember what happens to them, talk back when you speak
to them, and travel between installs as `.cpkmn` files.

Status: design stage. Nothing runs yet.

- `docs/plans/2026-10-30-gotcha-design.md` is the design and
  decision log.
- `docs/cpkmn-format.md` is the pokemon file spec;
  `packages/cpkmn/schema/cpkmn.schema.json` is its schema.
- `docs/reference/home-screen.png` is the concept render for the Home screen.
- `.claude/agents/` holds the specialists that build each slice. `CLAUDE.md`
  says which one owns what.

Cobblemon's models, textures, animations and sounds are not in this repo and
must not be committed. Drop the mod jar at `assets/cobblemon/cobblemon.jar`
and the extractor builds the runtime bundle.
