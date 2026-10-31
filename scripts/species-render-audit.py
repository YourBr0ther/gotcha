"""Rendered audit of every species: loads each one in the dev world page,
checks that it draws, that its idle and walk clips move bones, that sleep,
cry and faint resolve, that every clip in its animation file samples without
NaN, and screenshots idle, walk and sleep.

    python3 -I scripts/species-render-audit.py <outdir> [--base http://localhost:3300] [--workers 3] [--only a,b,c]

Writes <outdir>/json/<species>.json and <outdir>/img/<species>-{idle,walk,sleep}.png.
Resumable: a species with a json file is skipped.
"""
import json, os, sys, time, argparse, urllib.request
from multiprocessing import Process

from playwright.sync_api import sync_playwright

PROBE = r"""
() => {
  const rig = window.__creatureRig;
  if (!rig) return null;
  const bones = {};
  for (const [n, b] of rig.loaded.model.bones) bones[n] = [b.rotation.x, b.rotation.y, b.rotation.z, b.position.x, b.position.y, b.position.z];
  return bones;
}
"""

INFO = r"""
() => {
  const rig = window.__creatureRig;
  const s = window.__worldStats || {};
  const model = rig.loaded.model;
  const bounds = model.bounds;
  const tex = rig.loaded.texture;
  const poser = rig.loaded.poser;
  const poses = {};
  const missingBones = new Set();
  const boneRefs = (p) => [].concat(p.legs || [], p.arms || [], p.wings || [], p.bone ? [p.bone] : []);
  for (const [k, v] of Object.entries(poser.poses)) {
    poses[k] = { clips: v.clips, procedural: v.procedural.map((p) => p.kind + (p.kind === 'unknown' ? ':' + p.name : '')) };
    for (const p of v.procedural) for (const b of boneRefs(p)) if (!model.bones.has(b)) missingBones.add(p.kind + ':' + b);
  }
  const clips = rig.loaded.clips;
  const clipReport = {};
  for (const name of clips.names()) {
    try {
      const c = clips.get(name);
      if (!c) { clipReport[name] = { error: 'not built' }; continue; }
      let nan = false, tracks = c.clip.tracks.length;
      for (const t of c.clip.tracks) { for (let i = 0; i < t.values.length; i++) { if (Number.isNaN(t.values[i])) { nan = true; break; } } if (nan) break; }
      clipReport[name] = { tracks, duration: +c.clip.duration.toFixed(3), loop: c.loop, nan };
    } catch (e) { clipReport[name] = { error: String(e && e.message || e) }; }
  }
  let pos = rig.group.position;
  return {
    bones: model.bones.size,
    meshes: rig.loaded.meshes,
    height: +rig.height.toFixed(3),
    scale: rig.loaded.bundle.baseScale ?? 1,
    bounds: [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].map((v) => +v.toFixed(3)),
    finite: [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z, pos.x, pos.y, pos.z].every(Number.isFinite),
    texture: tex && tex.image ? [tex.image.width, tex.image.height] : null,
    emissive: !!rig.loaded.emissive,
    locomotion: rig.locomotion,
    medium: rig.currentMedium,
    activity: rig.currentActivity,
    poser: { poses, cry: poser.cry, faint: poser.faint, quirks: poser.quirks, missingProceduralBones: [...missingBones] },
    clips: clipReport,
    cryUrl: rig.loaded.bundle.sounds && rig.loaded.bundle.sounds.cry || null,
    stats: { calls: s.calls, triangles: s.triangles, programs: s.programs },
    load: s.load || null,
    particles: typeof rig.particleCount === 'number' ? { count: rig.particleCount, emitters: rig.activeEmitters || [] } : 'unsupported',
  };
}
"""


WALK = r"""
() => {
  const r = window.__creatureRig;
  const h = window.__worldHandle;
  const p = r.group.position;
  const spots = r.diorama.spots;
  const loco = r.locomotion;
  const want = loco.flies ? null : (loco.waterOnly || loco.prefersWater) ? 'water' : 'land';
  const far = Object.keys(spots).filter((n) => !want || (spots[n].medium || 'land') === want).sort((a, b) => {
    const da = (spots[a].x - p.x) ** 2 + (spots[a].z - p.z) ** 2;
    const db = (spots[b].x - p.x) ** 2 + (spots[b].z - p.z) ** 2;
    return db - da;
  });
  for (const name of far) {
    h.moveTo(name).catch(() => {});
    if (r.isMoving) return { spot: name, activity: r.currentActivity };
  }
  return { spot: null, activity: r.currentActivity };
}
"""


def delta(a, b):
    """Sum of absolute rotation differences across bones, plus the largest single change."""
    if not a or not b:
        return None
    total = 0.0
    biggest = (0.0, "")
    for name, va in a.items():
        vb = b.get(name)
        if not vb:
            continue
        d = sum(abs(va[i] - vb[i]) for i in range(3)) + 0.1 * sum(abs(va[i] - vb[i]) for i in range(3, 6))
        total += d
        if d > biggest[0]:
            biggest = (d, name)
    return {"total": round(total, 4), "maxBone": biggest[1], "max": round(biggest[0], 4)}


def travel(samples):
    """Motion over a run of samples: the sum of consecutive deltas, with the bone that moved most overall."""
    total = 0.0
    best = (0.0, "")
    for x, y in zip(samples, samples[1:]):
        d = delta(x, y)
        if not d:
            continue
        total += d["total"]
        if d["max"] > best[0]:
            best = (d["max"], d["maxBone"])
    return {"total": round(total, 4), "maxBone": best[1], "max": round(best[0], 4), "samples": len(samples)}


def head(url):
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.headers.get("content-length")
    except Exception as e:  # noqa: BLE001
        return getattr(e, "code", None) or str(e), None


def wait_visible(page, timeout=45):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate("() => performance.getEntriesByName('world:creature-visible').length > 0 && !!window.__creatureRig"):
            return True
        if page.evaluate("() => !!(window.__worldStats && window.__worldStats.extra && window.__worldStats.extra.startsWith('error'))"):
            return False
        time.sleep(0.15)
    return False


def reshoot_shard(shard, workers, species, out, base, viewport, crop):
    """Gallery shots only: idle, then sleep where it stands, then a walk shot a moment after it sets off, all in the crop."""
    mine = [s for i, s in enumerate(species) if i % workers == shard]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-unsafe-swiftshader"])
        page = browser.new_context(viewport=viewport, device_scale_factor=1).new_page()
        for n, sp in enumerate(mine):
            t0 = time.time()
            try:
                jpath = f"{out}/json/{sp}.json"
                rec = json.load(open(jpath)) if os.path.exists(jpath) else {}
                diorama = "&diorama=pond" if rec.get("diorama") == "pond" else ""
                page.goto(f"{base}/world?species={sp}&demo=hold&ambient=0&depth=0&hour=12&debug=0{diorama}", wait_until="domcontentloaded", timeout=60000)
                if not wait_visible(page):
                    print(f"[{shard}] {sp} not visible", flush=True)
                    continue
                time.sleep(0.8)
                tall = page.evaluate("() => window.__creatureRig.height") >= 2.2
                shot = None if tall else crop
                page.screenshot(path=f"{out}/img/{sp}-idle.png", clip=shot)
                page.evaluate("() => window.__worldHandle.play('sleep')")
                time.sleep(1.6)
                page.screenshot(path=f"{out}/img/{sp}-sleep.png", clip=shot)
                page.evaluate("() => window.__worldHandle.play('idle')")
                time.sleep(0.5)
                page.evaluate(WALK)
                time.sleep(0.6)
                page.screenshot(path=f"{out}/img/{sp}-walk.png", clip=shot)
                print(f"[{shard}] {n + 1}/{len(mine)} {sp} shot {round(time.time() - t0, 1)}s", flush=True)
            except Exception as ex:  # noqa: BLE001
                print(f"[{shard}] {sp} FAILED {str(ex)[:120]}", flush=True)
        browser.close()


def run_shard(shard, workers, species, out, base, viewport, crop, force=False):
    mine = [s for i, s in enumerate(species) if i % workers == shard]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport=viewport, device_scale_factor=1)
        page = ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: logs.append(("pageerror", str(e))))
        for n, sp in enumerate(mine):
            jpath = f"{out}/json/{sp}.json"
            if os.path.exists(jpath) and not force:
                continue
            logs.clear()
            rec = {"species": sp, "ok": False}
            t0 = time.time()
            try:
                page.goto(f"{base}/world?species={sp}&demo=hold&ambient=0&depth=0&hour=12&debug=1", wait_until="domcontentloaded", timeout=60000)
                visible = False
                while time.time() - t0 < 45:
                    if page.evaluate("() => performance.getEntriesByName('world:creature-visible').length > 0 && !!window.__creatureRig"):
                        visible = True
                        break
                    if page.evaluate("() => !!(window.__worldStats && window.__worldStats.extra && window.__worldStats.extra.startsWith('error'))"):
                        break
                    time.sleep(0.15)
                rec["loadSeconds"] = round(time.time() - t0, 2)
                rec["visible"] = visible
                if not visible:
                    rec["status"] = page.evaluate("() => window.__worldStats && window.__worldStats.extra")
                    raise RuntimeError("creature never became visible")
                time.sleep(0.8)
                info = page.evaluate(INFO)
                # A species that never leaves the water gets the pond, where it has room to swim.
                if info["locomotion"].get("waterOnly"):
                    page.goto(f"{base}/world?species={sp}&demo=hold&ambient=0&depth=0&hour=12&debug=1&diorama=pond", wait_until="domcontentloaded", timeout=60000)
                    t1 = time.time()
                    while time.time() - t1 < 45:
                        if page.evaluate("() => performance.getEntriesByName('world:creature-visible').length > 0 && !!window.__creatureRig"):
                            break
                        time.sleep(0.15)
                    time.sleep(0.8)
                    info = page.evaluate(INFO)
                    rec["diorama"] = "pond"
                rec.update(info)
                # A tall creature fills the crop; keep the whole frame for it.
                shot = crop if info["height"] < 2.2 else None
                rec["fullFrame"] = shot is None
                idle_samples = [page.evaluate(PROBE)]
                for _ in range(3):
                    time.sleep(0.25)
                    idle_samples.append(page.evaluate(PROBE))
                a = idle_samples[0]
                rec["idleMotion"] = travel(idle_samples)
                page.screenshot(path=f"{out}/img/{sp}-idle.png", clip=shot)
                # Walk for real: travel toward the farthest spot the creature can
                # reach, so the procedural leg layers (which scale with speed) swing.
                walk = page.evaluate(WALK)
                rec["walkActivity"] = walk["activity"]
                rec["walkSpot"] = walk["spot"]
                time.sleep(0.9)
                walk_samples = [page.evaluate(PROBE)]
                moving1 = page.evaluate("() => [window.__creatureRig.isMoving, +window.__creatureRig.currentSpeed.toFixed(2)]")
                for _ in range(4):
                    time.sleep(0.15)
                    walk_samples.append(page.evaluate(PROBE))
                moving2 = page.evaluate("() => [window.__creatureRig.isMoving, +window.__creatureRig.currentSpeed.toFixed(2)]")
                c = walk_samples[0]
                rec["walkMoving"] = [moving1, moving2]
                rec["walkMotion"] = travel(walk_samples)
                rec["walkVsIdle"] = delta(a, c)
                rec["walkRunning"] = page.evaluate("() => { const r = window.__creatureRig; return r.baseClips.map((n) => [n, r.actions.get(n) ? r.actions.get(n).isRunning() : null, r.actions.get(n) ? +r.actions.get(n).getEffectiveWeight().toFixed(2) : null]); }")
                page.screenshot(path=f"{out}/img/{sp}-walk.png")
                page.evaluate("() => { window.__creatureRig.cancelMove(); window.__worldHandle.play('idle'); }")
                time.sleep(0.3)
                # Sleep
                page.evaluate("() => window.__worldHandle.play('sleep')")
                time.sleep(1.6)
                e = page.evaluate(PROBE)
                rec["sleep"] = {
                    "procedural": page.evaluate("() => window.__creatureRig.lyingDown"),
                    "progress": page.evaluate("() => +window.__creatureRig.sleepProgress.toFixed(2)"),
                    "clips": page.evaluate("() => window.__creatureRig.baseClips"),
                    "vsIdle": delta(a, e),
                }
                page.screenshot(path=f"{out}/img/{sp}-sleep.png", clip=shot)
                page.evaluate("() => window.__worldHandle.play('idle')")
                time.sleep(0.6)
                # Cry: the clip action should be running right after the call.
                page.evaluate("() => window.__worldHandle.cry()")
                time.sleep(0.15)
                rec["cry"] = page.evaluate("() => { const r = window.__creatureRig; const n = r.loaded.poser.cry; const a = n ? r.actions.get(n) : null; return { clip: n || null, running: a ? a.isRunning() : null, weight: a ? +a.getEffectiveWeight().toFixed(2) : null }; }")
                if rec.get("cryUrl"):
                    status, size = head(base + rec["cryUrl"] if rec["cryUrl"].startswith("/") else rec["cryUrl"])
                    rec["cry"]["http"] = status
                    rec["cry"]["bytes"] = size
                time.sleep(0.5)
                # Faint
                rec["faint"] = page.evaluate("() => { window.__worldHandle.play('faint'); const r = window.__creatureRig; const n = r.loaded.poser.faint; const a = n ? r.actions.get(n) : null; return { clip: n || null, running: a ? a.isRunning() : null, activity: r.currentActivity }; }")
                time.sleep(0.5)
                f = page.evaluate(PROBE)
                rec["faint"]["vsIdle"] = delta(a, f)
                if isinstance(rec.get("particles"), dict):
                    rec["particlesAfterFaint"] = page.evaluate("() => window.__creatureRig.particleCount")
                rec["ok"] = True
            except Exception as ex:  # noqa: BLE001
                rec["error"] = str(ex)[:500]
            rec["console"] = [f"{t}: {m[:300]}" for t, m in logs][:40]
            rec["seconds"] = round(time.time() - t0, 2)
            with open(jpath, "w") as fh:
                json.dump(rec, fh, indent=1)
            print(f"[{shard}] {n + 1}/{len(mine)} {sp} {'ok' if rec['ok'] else 'FAIL ' + rec.get('error', '')} {rec['seconds']}s", flush=True)
        browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--base", default="http://localhost:3300")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--only", default="")
    ap.add_argument("--cache", default=".cobblemon-cache")
    ap.add_argument("--force", action="store_true", help="redo species that already have a json file")
    ap.add_argument("--reshoot", action="store_true", help="only retake the idle, sleep and walk shots; keep the json")
    args = ap.parse_args()
    os.makedirs(f"{args.out}/json", exist_ok=True)
    os.makedirs(f"{args.out}/img", exist_ok=True)
    if args.only:
        species = args.only.split(",")
    else:
        with open(f"{args.cache}/index.json") as fh:
            species = sorted(json.load(fh)["species"].keys())
    viewport = {"width": 360, "height": 640}
    crop = {"x": 30, "y": 150, "width": 300, "height": 360}
    if args.reshoot:
        procs = [Process(target=reshoot_shard, args=(k, args.workers, species, args.out, args.base, viewport, crop)) for k in range(args.workers)]
    else:
        procs = [Process(target=run_shard, args=(k, args.workers, species, args.out, args.base, viewport, crop, args.force)) for k in range(args.workers)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()


if __name__ == "__main__":
    main()
