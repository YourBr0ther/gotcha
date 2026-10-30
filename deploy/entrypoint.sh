#!/bin/sh
# Container entrypoint. On first start it turns the Cobblemon jar on the data
# volume into the asset cache, kicks off the pokedex build in the background,
# applies migrations, then serves. Every step checks for its own output first,
# so a restart with the caches in place goes straight to the server.
#
#   GOTCHA_DATA_DIR      the volume, /data in the image
#   COBBLEMON_JAR        the mod jar, $GOTCHA_DATA_DIR/cobblemon.jar by default
#   GOTCHA_SKIP_MIGRATE  set to 1 when something else already migrated
set -eu

DATA="${GOTCHA_DATA_DIR:-/data}"
JAR="${COBBLEMON_JAR:-$DATA/cobblemon.jar}"
COBBLEMON="$DATA/cobblemon-cache"
POKEDEX="$DATA/pokedex-cache"

log() { echo "[entrypoint] $*"; }

if [ ! -f "$COBBLEMON/index.json" ]; then
  if [ -f "$JAR" ]; then
    log "no Cobblemon cache at $COBBLEMON, extracting from $JAR (about a minute)"
    node /app/tools/extract.mjs --jar "$JAR" --out "$COBBLEMON"
  else
    log "no Cobblemon cache and no jar at $JAR. Starting without models; copy the jar in and restart." >&2
  fi
fi

if [ -f "$COBBLEMON/index.json" ] && [ ! -f "$POKEDEX/species/index.json" ]; then
  log "no pokedex cache, building it in the background from PokeAPI"
  (
    if node /app/tools/pokedex.mjs --cobblemon "$COBBLEMON" --out "$POKEDEX/species" --cache "$POKEDEX/pokeapi"; then
      log "pokedex cache ready"
    else
      # The CLI writes index.json even when some species failed. Drop it so
      # the next start retries; the PokeAPI cache keeps the retry short.
      rm -f "$POKEDEX/species/index.json"
      log "pokedex build failed; it will run again on the next start" >&2
    fi
  ) &
fi

if [ "${GOTCHA_SKIP_MIGRATE:-0}" != "1" ]; then
  log "applying migrations"
  node /app/tools/migrate.mjs
fi

log "starting server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node /app/server.js
