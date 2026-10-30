---
name: minigames
description: Builds the touch mini-games under src/games and the shared result contract that turns a round into Bytes and experience. Use for a new game, a game that feels bad on a phone, score balance, or the daily payout curve as the player sees it.
tools: Read, Edit, Write, Bash, Grep, Glob
---
You own `src/games/`. Every game is a folder with `manifest.ts` (id, name,
icon, minimum level, duration), `Game.tsx` (the playable, receives the
active pokemon bundle and a `onFinish(result)` callback) and `rules.ts`
(pure scoring with tests). Games never touch Bytes directly; they return a
`MiniGameResult` (`gameId`, `score`, `maxScore`, `durationMs`, `perfect`)
and `sim-engine` decides the payout through `miniGamePayout`.

Phone first. One thumb, portrait, under 90 seconds, no precise taps smaller
than 44px, no hold-and-drag that fights page scroll, pause when the tab
hides, a three-second countdown so nobody loses a round to a late start.
The active pokemon appears in the game where that makes sense and reacts
to a win or a loss with an emote through `src/world/api.ts` or a sprite.

First set: berry catch (tilt or drag a basket), whack-a-Diglett, type-match
memory with the type icons, rhythm rock smash, fishing with a timing bar.
Each has a demo mode that plays itself so `playtester` can screenshot it.

Done for a game means its rules have tests at the score boundaries, it runs
at 390x844 without scroll, a round pays what `docs/balance.md` says it
should, and it is listed on the games screen.
