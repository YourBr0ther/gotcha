"""Builds the species report from the static audit and the rendered audit.

    python3 -I scripts/species-report.py test-results/species-audit/<date>

Reads static.json and render/json/*.json, writes REPORT.md, index.html and
thumbs/ (150x180 JPEGs of the idle, walk and sleep shots) in that folder.
"""
import json, os, sys, glob, html
from collections import Counter, defaultdict

from PIL import Image

ROOT = sys.argv[1]
STATIC = json.load(open(f"{ROOT}/static.json"))
SPECIES = STATIC["species"]
RENDER = {}
for f in glob.glob(f"{ROOT}/render/json/*.json"):
    r = json.load(open(f))
    RENDER[r["species"]] = r

IDLE_STILL = 0.02       # summed bone rotation change over 0.7 s below this is a frozen idle
WALK_STILL = 0.05
WALK_SAME = 0.15        # walk pose within this of the idle pose: the walk clip did not take
EMOTE_CLIPS = ("happy", "sad", "angry", "surprised", "surprise", "shocked", "unamused", "dance", "pose", "hurt", "recoil", "physical", "special", "status", "shock", "mouth_open", "smile")
TEST_CLIPS = ("test", "walkspeed", "runspeed", "scale", "render", "new", "base", "placeholder", "WIP", "expressions", "demon", "wangs")


def thumb(sp, kind):
    src = f"{ROOT}/render/img/{sp}-{kind}.png"
    dst = f"{ROOT}/thumbs/{sp}-{kind}.jpg"
    if not os.path.exists(src):
        return None
    if not os.path.exists(dst):
        im = Image.open(src).convert("RGB")
        im.thumbnail((180, 216))
        im.save(dst, quality=72, optimize=True)
    return f"thumbs/{sp}-{kind}.jpg"


def clip_static(sp, full):
    """The static audit's record for a clip the renderer names `animation.<group>.<name>`."""
    short = full.split(".", 1)[1] if full.startswith("animation.") else full
    group, _, name = short.rpartition(".")
    return SPECIES[sp]["clips"].get(f"{group}:{name}")


def motion(m):
    return m["total"] if m else None


def classify(sp):
    """One row of verdicts per species, from both audits."""
    s = SPECIES[sp]
    r = RENDER.get(sp)
    row = {"species": sp, "name": s["name"], "dex": s["dex"], "notes": [], "flags": []}
    if not r:
        row["flags"].append("not rendered")
        return row
    if not r.get("ok"):
        row["flags"].append("render failed")
        row["notes"].append(r.get("error", "")[:160])
        return row
    # Idle
    idle = motion(r.get("idleMotion"))
    idle_kind = "clip" if r["poser"]["poses"].get("idle", {}).get("clips") else ("procedural" if r["poser"]["poses"].get("idle") else "none")
    row["idle"] = idle_kind
    idle_clips = (r["poser"]["poses"].get("idle") or {}).get("clips") or []
    idle_animated = any((c := clip_static(sp, n)) and ((c.get("molang") or 0) > 0 or (c.get("length") or 0) > 0) for n in idle_clips)
    row["idleStaticByData"] = bool(idle_clips) and not idle_animated
    if idle is not None and idle < IDLE_STILL and idle_animated:
        row["flags"].append("idle frozen")
    # Walk
    walk = motion(r.get("walkMotion"))
    diff = motion(r.get("walkVsIdle"))
    act = r.get("walkActivity")
    pose = r["poser"]["poses"].get(act) or {}
    walk_clips = pose.get("clips") or []
    idle_clips = (r["poser"]["poses"].get("idle") or {}).get("clips") or []
    row["walk"] = act
    if walk_clips and walk_clips != idle_clips:
        row["walkSource"] = "clip"
    elif pose.get("procedural"):
        row["walkSource"] = "procedural"
    else:
        row["walkSource"] = "idle fallback"
        on_disk = [c.split(":")[1] for c in s["clips"] if c.split(":")[1] in ("ground_walk", "water_swim", "air_fly", "ground_run")]
        row["flags"].append("walk clip on disk unused" if on_disk else "no walk clip")
        if on_disk:
            row["notes"].append("unused: " + ", ".join(sorted(set(on_disk))))
    moving = r.get("walkMoving") or []
    travelled = any(m[0] for m in moving)
    row["walkTravelled"] = travelled
    if not travelled:
        row["flags"].append("could not travel")
    elif walk is not None and walk < WALK_STILL and row["walkSource"] != "idle fallback":
        row["flags"].append("walk still")
    missing = r["poser"].get("missingProceduralBones") or []
    walk_missing = [m for m in missing if not m.startswith("look:")]
    if walk_missing:
        row["flags"].append("poser names missing bones")
        row["notes"].append("missing bones: " + ", ".join(walk_missing))
    if row["walkSource"] == "clip" and diff is not None and diff < WALK_SAME:
        row["flags"].append("walk looks like idle")
    # Sleep
    sl = r.get("sleep") or {}
    row["sleep"] = "procedural lie-down" if sl.get("procedural") else ("clip" if sl.get("clips") and sl["clips"] != idle_clips else "idle pose")
    if row["sleep"] == "idle pose":
        row["flags"].append("sleep is idle")
    # Cry
    cry = r.get("cry") or {}
    row["cryClip"] = bool(cry.get("clip"))
    row["cryFile"] = s["cry"] == "present" and cry.get("http") == 200
    cry_tracks = r["clips"].get(cry.get("clip") or "", {}).get("tracks")
    row["crySoundOnly"] = bool(cry.get("clip")) and cry_tracks == 0
    if not row["cryClip"]:
        row["flags"].append("no cry clip")
    if not row["cryFile"]:
        row["flags"].append("no cry sound")
    elif cry.get("clip") and not cry.get("running") and not row["crySoundOnly"]:
        row["flags"].append("cry clip did not start")
    # Faint
    ft = r.get("faint") or {}
    row["faint"] = "clip" if ft.get("clip") else "none"
    # Clips
    nan = [n for n, c in r["clips"].items() if c.get("nan")]
    errs = [n for n, c in r["clips"].items() if c.get("error")]
    if nan:
        row["flags"].append("NaN in clips")
        row["notes"].append("NaN: " + ", ".join(n.split(".")[-1] for n in nan))
    if errs:
        row["flags"].append("clip build error")
        row["notes"].append("error: " + ", ".join(n.split(".")[-1] for n in errs)[:120])
    short = lambda n: n.split(":")[-1]
    unused = [short(c) for c in s["unusedClips"]]
    row["emoteClips"] = sorted({c for c in unused if any(c == e or c.startswith(e + "_") for e in EMOTE_CLIPS)})
    row["otherClips"] = sorted({c for c in unused if c not in row["emoteClips"] and not any(t in c for t in TEST_CLIPS)})
    row["clipCount"] = len(s["clips"])
    # Particles
    row["particles"] = sorted({(p["effect"], p["clip"].split(".")[-1], p.get("locator") or "root") for p in s["particles"]})
    pr = r.get("particles")
    row["particlesRendered"] = pr if isinstance(pr, dict) else None
    if row["particles"] and row["particlesRendered"] is None:
        row["flags"].append("particles not rendered")
    # Console
    molang = sorted({m for m in r.get("console", []) if "molang" in m.lower()})
    other = [m for m in r.get("console", []) if "molang" not in m.lower() and "GL Driver" not in m and "ReadPixels" not in m]
    if molang:
        row["flags"].append("unknown molang")
        row["notes"].extend(m.split("]", 1)[-1].strip()[:100] for m in molang[:3])
    if other:
        row["flags"].append("console errors")
        row["notes"].extend(m[:140] for m in other[:3])
    row["stats"] = r.get("stats") or {}
    row["height"] = r.get("height")
    row["bones"] = r.get("bones")
    row["meshes"] = r.get("meshes")
    row["load"] = r.get("loadSeconds")
    row["fullFrame"] = r.get("fullFrame", False)
    row["emissive"] = bool(s["emissiveLayers"])
    row["locomotion"] = r.get("locomotion") or s["locomotion"]
    return row


rows = [classify(sp) for sp in sorted(SPECIES, key=lambda k: (SPECIES[k]["dex"], k))]
flags = Counter(f for r in rows for f in r["flags"])
rendered = [r for r in rows if "render failed" not in r["flags"] and "not rendered" not in r["flags"]]


def md_table(header, lines):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in l) + " |" for l in lines]
    return "\n".join(out)


def sp_link(r):
    return f"[{r['name']}](index.html#{r['species']})"


md = []
md.append(f"# Species audit, {ROOT.rstrip('/').split('/')[-1]}")
md.append("")
md.append(f"Cobblemon {STATIC.get('cacheRoot', '')} cache, {STATIC['total']} species extracted, {len(STATIC['skipped'])} skipped by the extractor (not implemented in Cobblemon, or no animation file). Every species was loaded in the dev world page in headless Chromium, held still, then walked, put to sleep, made to cry and made to faint, with bone transforms sampled before and after each step. `index.html` next to this file holds the idle, walk and sleep shot of every species; the per-species table at the end links into it.")
md.append("")
md.append("## Totals")
md.append("")
tot = [
    ("Loaded and drew a first frame", len(rendered), len(rows)),
    ("Idle clip moves bones", sum(1 for r in rendered if "idle frozen" not in r["flags"] and not r.get("idleStaticByData")), len(rendered)),
    ("Idle pose is a still pose in Cobblemon's data", sum(1 for r in rendered if r.get("idleStaticByData")), len(rendered)),
    ("Walk from a walk clip", sum(1 for r in rendered if r.get("walkSource") == "clip"), len(rendered)),
    ("Walk from a procedural layer", sum(1 for r in rendered if r.get("walkSource") == "procedural"), len(rendered)),
    ("Walk falls back to the idle pose (slides)", sum(1 for r in rendered if r.get("walkSource") == "idle fallback"), len(rendered)),
    ("Sleep clip", sum(1 for r in rendered if r.get("sleep") == "clip"), len(rendered)),
    ("Sleep by the procedural lie-down", sum(1 for r in rendered if r.get("sleep") == "procedural lie-down"), len(rendered)),
    ("Cry clip in the poser", sum(1 for r in rendered if r.get("cryClip")), len(rendered)),
    ("Cry sound file served", sum(1 for r in rendered if r.get("cryFile")), len(rendered)),
    ("Cry clip is sound only (no bone moves)", sum(1 for r in rendered if r.get("crySoundOnly")), len(rendered)),
    ("Faint clip in the poser", sum(1 for r in rendered if r.get("faint") == "clip"), len(rendered)),
    ("Emote clips on disk the game does not play yet", sum(1 for r in rendered if r.get("emoteClips")), len(rendered)),
    ("Declare particle effects", sum(1 for r in rendered if r.get("particles")), len(rendered)),
    ("Emissive layer (glowing eyes or markings)", sum(1 for r in rendered if r.get("emissive")), len(rendered)),
    ("Clips with NaN samples", sum(1 for r in rendered if "NaN in clips" in r["flags"]), len(rendered)),
    ("Unknown Molang in a clip", sum(1 for r in rendered if "unknown molang" in r["flags"]), len(rendered)),
    ("Console errors while loading", sum(1 for r in rendered if "console errors" in r["flags"]), len(rendered)),
]
md.append(md_table(["Check", "Count", "Of"], tot))
md.append("")
md.append("## Flags")
md.append("")
md.append(md_table(["Flag", "Species"], sorted(flags.items(), key=lambda kv: -kv[1])))
md.append("")
for flag in ["render failed", "not rendered", "idle frozen", "walk still", "could not travel", "poser names missing bones", "walk looks like idle", "walk clip on disk unused", "no walk clip", "sleep is idle", "no cry clip", "no cry sound", "cry clip did not start", "NaN in clips", "clip build error", "particles not rendered", "unknown molang", "console errors"]:
    hit = [r for r in rows if flag in r["flags"]]
    if not hit:
        continue
    md.append(f"### {flag} ({len(hit)})")
    md.append("")
    md.append(", ".join(sp_link(r) for r in hit))
    notes = [(r, n) for r in hit for n in r["notes"]]
    if notes and flag in ("render failed", "NaN in clips", "clip build error", "unknown molang", "console errors", "poser names missing bones", "walk clip on disk unused"):
        md.append("")
        seen = Counter(n for _, n in notes)
        for n, c in seen.most_common(12):
            md.append(f"- {c}x `{n}`")
    md.append("")

md.append("## Particle effects")
md.append("")
md.append("Cobblemon attaches Bedrock particle emitters to animation keyframes. The ones below are the species whose overworld clips fire them, with the locator the emitter is attached to.")
md.append("")
plines = []
for r in rows:
    for effect, clip, loc in r.get("particles") or []:
        pr = r.get("particlesRendered")
        plines.append((sp_link(r), effect, clip, loc, "yes" if pr and pr.get("count", 0) > 0 else ("no" if pr is not None else "renderer lacks support")))
md.append(md_table(["Species", "Effect", "Clip", "Locator", "Rendered"], plines))
md.append("")

md.append("## Heaviest models")
md.append("")
heavy = sorted(rendered, key=lambda r: -(r["stats"].get("triangles") or 0))[:15]
md.append(md_table(["Species", "Bones", "Meshes", "Triangles in scene", "Draw calls", "Height (blocks)"], [(sp_link(r), r["bones"], r["meshes"], r["stats"].get("triangles"), r["stats"].get("calls"), r["height"]) for r in heavy]))
md.append("")
slow = sorted(rendered, key=lambda r: -(r["load"] or 0))[:10]
md.append("Slowest to load (headless software GL, so absolute times are pessimistic):")
md.append("")
md.append(md_table(["Species", "Seconds to first frame"], [(sp_link(r), r["load"]) for r in slow]))
md.append("")

md.append("## Every species")
md.append("")
md.append("Idle, walk and sleep say where the pose came from. Extra lists the clips on disk the poser never plays (emotes first, then the rest). Flags repeat the sections above.")
md.append("")
lines = []
for r in rows:
    if "render failed" in r["flags"] or "not rendered" in r["flags"]:
        lines.append((r["dex"], sp_link(r), "", "", "", "", "", "", "", "; ".join(r["flags"] + r["notes"])))
        continue
    extra = r["emoteClips"] + r["otherClips"]
    extra_s = ", ".join(extra[:8]) + (f" +{len(extra) - 8}" if len(extra) > 8 else "")
    cry = ("clip" if r["cryClip"] else "no clip") + ("+sound" if r["cryFile"] else ", no sound")
    parts = ", ".join(sorted({e for e, _, _ in r["particles"]})) if r["particles"] else ""
    lines.append((r["dex"], sp_link(r), r["idle"], r["walkSource"], r["sleep"], cry, r["faint"], extra_s, parts, "; ".join(f for f in r["flags"])))
md.append(md_table(["Dex", "Species", "Idle", "Walk", "Sleep", "Cry", "Faint", "Extra clips", "Particles", "Flags"], lines))
md.append("")
open(f"{ROOT}/REPORT.md", "w").write("\n".join(md))
json.dump({r["species"]: {"flags": r["flags"], "notes": r["notes"], "walkSource": r.get("walkSource"), "sleep": r.get("sleep"), "height": r.get("height")} for r in rows}, open(f"{ROOT}/flags.json", "w"), indent=1)

# HTML gallery
os.makedirs(f"{ROOT}/thumbs", exist_ok=True)
cards = []
for r in rows:
    imgs = "".join(
        f'<figure><img loading="lazy" src="{t}" alt="{k}"><figcaption>{k}</figcaption></figure>' if (t := thumb(r["species"], k)) else f'<figure class="missing"><figcaption>{k}: no shot</figcaption></figure>'
        for k in ("idle", "walk", "sleep")
    )
    badges = "".join(f'<span class="flag">{html.escape(f)}</span>' for f in r["flags"])
    facts = []
    if "render failed" not in r["flags"] and "not rendered" not in r["flags"]:
        facts.append(f"idle {r['idle']} · walk {r['walkSource']} · sleep {r['sleep']}")
        facts.append(("cry clip" if r["cryClip"] else "no cry clip") + (" + sound" if r["cryFile"] else ", no sound") + f" · faint {r['faint']}")
        if r["emoteClips"]:
            facts.append("emotes on disk: " + ", ".join(r["emoteClips"]))
        if r["otherClips"]:
            facts.append("other clips: " + ", ".join(r["otherClips"][:10]) + (" …" if len(r["otherClips"]) > 10 else ""))
        if r["particles"]:
            facts.append("particles: " + "; ".join(f"{e} on {loc} ({c})" for e, c, loc in r["particles"]))
        facts.append(f"{r['bones']} bones, {r['meshes']} meshes, {r['stats'].get('triangles')} tris, {r['stats'].get('calls')} calls, {r['height']} blocks tall")
    facts += r["notes"]
    cards.append(
        f'<article id="{r["species"]}" data-flags="{html.escape(" ".join(r["flags"]))}" data-name="{html.escape(r["name"].lower())}">'
        f'<header><b>#{r["dex"]} {html.escape(r["name"])}</b> <code>{r["species"]}</code> {badges}</header>'
        f'<div class="shots">{imgs}</div>'
        f'<ul>{"".join(f"<li>{html.escape(x)}</li>" for x in facts)}</ul></article>'
    )
flag_options = "".join(f'<option value="{html.escape(f)}">{html.escape(f)} ({c})</option>' for f, c in sorted(flags.items(), key=lambda kv: -kv[1]))
page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gotcha species audit</title>
<style>
body{{font:14px/1.4 system-ui,sans-serif;background:#0f1322;color:#e6ebff;margin:0;padding:16px}}
h1{{font-size:20px;margin:0 0 8px}} .tools{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;position:sticky;top:0;background:#0f1322;padding:8px 0}}
input,select{{font:inherit;padding:6px 8px;border-radius:6px;border:1px solid #334;background:#161b2e;color:#e6ebff}}
main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}}
article{{background:#161b2e;border:1px solid #273052;border-radius:10px;padding:10px}} article.hide{{display:none}}
header{{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}} code{{color:#9fb0ff}}
.flag{{background:#5a2d3a;color:#ffd0d8;border-radius:999px;padding:1px 8px;font-size:12px}}
.shots{{display:flex;gap:6px}} figure{{margin:0;text-align:center;flex:1}} figure img{{width:100%;border-radius:6px;image-rendering:auto}} figcaption{{font-size:12px;color:#9aa3c7}}
figure.missing{{display:grid;place-items:center;min-height:120px;background:#0f1322;border-radius:6px}}
ul{{margin:6px 0 0;padding-left:18px;color:#c2c9e6;font-size:13px}}
</style></head><body>
<h1>Gotcha species audit</h1>
<div class="tools"><input id="q" placeholder="filter by name or id"><select id="f"><option value="">all flags</option><option value="*">any flag</option>{flag_options}</select><span id="n"></span></div>
<main>{"".join(cards)}</main>
<script>
const q=document.getElementById('q'),f=document.getElementById('f'),n=document.getElementById('n');
function apply(){{const t=q.value.toLowerCase(),fl=f.value;let c=0;for(const a of document.querySelectorAll('article')){{const flags=a.dataset.flags;const ok=(!t||a.id.includes(t)||a.dataset.name.includes(t))&&(!fl||(fl==='*'?flags.length>0:flags.split(' ').includes(fl))||(fl!=='*'&&flags.includes(fl)));a.classList.toggle('hide',!ok);if(ok)c++;}}n.textContent=c+' species';}}
q.oninput=apply;f.onchange=apply;apply();
</script></body></html>"""
open(f"{ROOT}/index.html", "w").write(page)
print(f"{len(rows)} species, {len(RENDER)} rendered records; flags: {dict(flags)}")
