#!/usr/bin/env python3
"""
Turns a species render audit into the verdict file the server reads when it
decides which species may be offered: src/lib/data/animation-audit.json.

    python3 -I scripts/animation-verdicts.py test-results/species-audit/<date> src/lib/data/animation-audit.json

The audit (scripts/species-render-audit.py, then scripts/species-report.py)
loads every species in a browser and samples bone transforms. A species
whose idle moved less than IDLE_STILL over the sample, or whose walk fell
back to the idle pose or did not move, fails here. The file carries the
Cobblemon version it was measured on; for any other version the server
reads the poser instead. Rerun after a pack upgrade.
"""
import json
import sys
from pathlib import Path

IDLE_STILL = 0.02  # same bar as species-report.py

audit, out = Path(sys.argv[1]), Path(sys.argv[2])
flags = json.loads((audit / "flags.json").read_text())
version = json.loads(Path(".cobblemon-cache/index.json").read_text())["cobblemonVersion"]

audited, idle_still, walk_missing = [], [], []
for species in sorted(flags):
    try:
        r = json.loads((audit / "render" / "json" / f"{species}.json").read_text())
    except FileNotFoundError:
        continue
    if not r.get("ok"):
        continue
    audited.append(species)
    f = flags[species]
    if (r.get("idleMotion") or {}).get("total", 0) < IDLE_STILL:
        idle_still.append(species)
    if f["walkSource"] == "idle fallback" or "walk still" in f["flags"] or "walk looks like idle" in f["flags"]:
        walk_missing.append(species)

out.write_text(json.dumps({"cobblemonVersion": version, "auditedAt": audit.name, "audited": audited, "idleStill": idle_still, "walkMissing": walk_missing}, indent=0) + "\n")
ok = len(audited) - len(set(idle_still) | set(walk_missing))
print(f"{len(audited)} audited on {version}: {len(idle_still)} idle still, {len(walk_missing)} walk missing, {ok} pass")
