/**
 * Sweeps every extracted species and reports which cannot resolve an idle or
 * a walk pose to a real clip (or a procedural layer), so ambient and active
 * creatures never fall back to the bind pose. Run: pnpm anim:sweep
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.env.COBBLEMON_CACHE_DIR ?? path.resolve(".cobblemon-cache");
const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as { species: Record<string, unknown> };

const IDLE = ["STAND", "NONE", "PORTRAIT", "PROFILE", "FLOAT", "HOVER"];
const WALK = ["WALK", "SWIM", "FLY"];
const PROCEDURAL = /q\.(quadruped_walk|biped_walk|bimanual_swing|sine_wing_flap)/;

interface Pose { poseTypes?: string[]; animations?: unknown[]; clips?: string[]; isBattle?: boolean | string }
interface Manifest { posers?: Record<string, { poses?: Record<string, Pose>; synthesized?: boolean; unresolvedClips?: string[] }>; animations?: Record<string, { clips?: Record<string, unknown> }> }

function resolves(poses: Record<string, Pose>, types: string[]): "clip" | "procedural" | "none" {
  const candidates = Object.values(poses).filter((p) => p.poseTypes?.some((t) => types.includes(t)));
  const overworld = candidates.filter((p) => !(p.isBattle === true || p.isBattle === "true"));
  for (const p of overworld.length ? overworld : candidates) {
    if (p.clips?.length) return "clip";
    if ((p.animations ?? []).some((a) => typeof a === "string" && PROCEDURAL.test(a))) return "procedural";
  }
  return "none";
}

const missingIdle: string[] = [];
const missingWalk: string[] = [];
const noPoser: string[] = [];
let synthesized = 0;
for (const id of Object.keys(index.species).sort()) {
  const file = path.join(root, id, "manifest.json");
  if (!existsSync(file)) continue;
  const m = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  const poser = Object.values(m.posers ?? {})[0];
  if (!poser?.poses) { noPoser.push(id); continue; }
  if (poser.synthesized) synthesized += 1;
  if (resolves(poser.poses, IDLE) === "none") missingIdle.push(id);
  if (resolves(poser.poses, WALK) === "none") missingWalk.push(id);
}
const total = Object.keys(index.species).length;
console.log(`${total} species, ${synthesized} with synthesized posers`);
console.log(`no poser at all: ${noPoser.length} ${noPoser.join(" ")}`);
console.log(`no idle pose: ${missingIdle.length} ${missingIdle.join(" ")}`);
console.log(`no walk pose (falls back to idle while moving): ${missingWalk.length} ${missingWalk.join(" ")}`);
process.exit(noPoser.length ? 1 : 0);
