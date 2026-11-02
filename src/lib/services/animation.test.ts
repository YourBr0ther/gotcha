import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import audit from "@/lib/data/animation-audit.json";
import { animatesEnough, clipMoves, pickableSpecies, resetAnimationVerdicts, speciesAnimation, verdictFromPoser } from "./animation";

const ANIMATIONS = {
  vee: {
    clips: {
      blink: { bones: 2, length: 0.1667, molang: 0 },
      ground_idle: { bones: 19, molang: 0 },
      ground_walk: { bones: 20, length: 1.2, molang: 0 },
      hover: { bones: 12, molang: 40 },
    },
  },
};

function poser(poses: Record<string, { poseTypes: string[]; animations: string[] }>) {
  return { poses };
}

describe("verdictFromPoser", () => {
  it("a one-frame idle pose is still, a keyframed walk clip is a walk", () => {
    const v = verdictFromPoser(
      poser({
        standing: { poseTypes: ["STAND", "NONE"], animations: ["q.look('head')", "q.bedrock('vee', 'blink')", "q.bedrock('vee', 'ground_idle')"] },
        walking: { poseTypes: ["WALK"], animations: ["q.look('head')", "q.bedrock('vee', 'ground_walk')"] },
      }),
      ANIMATIONS,
    );
    expect(v).toEqual({ idle: false, walk: true });
  });

  it("a Molang idle moves; a walk that reuses the idle clip with no leg layer slides", () => {
    const v = verdictFromPoser(
      poser({
        standing: { poseTypes: ["STAND"], animations: ["q.bedrock('vee', 'hover')"] },
        walking: { poseTypes: ["WALK"], animations: ["q.bedrock('vee', 'hover')"] },
      }),
      ANIMATIONS,
    );
    expect(v).toEqual({ idle: true, walk: false });
  });

  it("a leg layer counts as a walk even over the idle clip, and a flier rests in its hover", () => {
    const v = verdictFromPoser(
      poser({
        hovering: { poseTypes: ["HOVER"], animations: ["q.bedrock('vee', 'hover')"] },
        flying: { poseTypes: ["FLY"], animations: ["q.bedrock('vee', 'hover')", "q.sine_wing_flap(0.5, 1, 'wing_left', 'wing_right')"] },
      }),
      ANIMATIONS,
    );
    expect(v).toEqual({ idle: true, walk: true });
  });

  it("no poses at all is neither", () => {
    expect(verdictFromPoser({ poses: {} }, ANIMATIONS)).toEqual({ idle: false, walk: false });
    expect(clipMoves(undefined)).toBe(false);
    expect(animatesEnough({ idle: true, walk: false })).toBe(false);
  });
});

describe("speciesAnimation", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.COBBLEMON_CACHE_DIR;
    resetAnimationVerdicts();
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.COBBLEMON_CACHE_DIR;
    else process.env.COBBLEMON_CACHE_DIR = previous;
    resetAnimationVerdicts();
  });

  async function fakeCache(version: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gotcha-anim-"));
    const stillOne = audit.idleStill[0];
    const species: Record<string, { dex: number; name: string; hash: string }> = { [stillOne]: { dex: 1, name: stillOne, hash: "x" }, newcomer: { dex: 2, name: "Newcomer", hash: "y" } };
    await writeFile(path.join(dir, "index.json"), JSON.stringify({ cobblemonVersion: version, species }));
    for (const id of Object.keys(species)) {
      await mkdir(path.join(dir, id), { recursive: true });
      // Both read as a fine walker from the poser; the audit says the first stands still.
      await writeFile(
        path.join(dir, id, "manifest.json"),
        JSON.stringify({
          cobblemonVersion: version,
          posers: { [id]: { synthesized: true, poses: { standing: { poseTypes: ["STAND"], animations: ["q.bedrock('vee', 'hover')"] }, walking: { poseTypes: ["WALK"], animations: ["q.bedrock('vee', 'ground_walk')"] } } } },
          animations: ANIMATIONS,
        }),
      );
    }
    process.env.COBBLEMON_CACHE_DIR = dir;
    return stillOne;
  }

  it("takes the audit's word on the pack it measured, and reads the poser for anything else", async () => {
    const still = await fakeCache(audit.cobblemonVersion);
    expect(await speciesAnimation(still)).toEqual({ idle: false, walk: true, source: "audit" });
    expect(await speciesAnimation("newcomer")).toEqual({ idle: true, walk: true, source: "poser" });
    expect([...(await pickableSpecies())]).toEqual(["newcomer"]);
  });

  it("reads the poser for every species on a pack the audit never saw", async () => {
    const still = await fakeCache("9.9.9+1.99");
    expect(await speciesAnimation(still)).toEqual({ idle: true, walk: true, source: "poser" });
    expect((await pickableSpecies()).size).toBe(2);
  });
});
