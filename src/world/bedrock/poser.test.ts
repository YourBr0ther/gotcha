import { describe, expect, it } from "vitest";
import cubePoser from "../fixtures/cube.poser.json";
import cubeAnim from "../fixtures/cube.animation.json";
import { clipNameFromExpression, parsePoserCall, proceduralFromExpression, readPoser, resolveActivity } from "./poser";
import type { BedrockAnimationFile, PoserFile } from "./types";

const poser = cubePoser as unknown as PoserFile;
const clipNames = Object.keys((cubeAnim as unknown as BedrockAnimationFile).animations);

/** The real Eevee poser from Cobblemon 1.8.4, trimmed. */
const eeveePoser: PoserFile = {
  animations: { cry: "q.bedrock_stateful('eevee', 'cry')" },
  poses: {
    standing: {
      animations: ["q.look('head', 1, 1, 70, -45, 45, -45)", "q.bedrock('eevee', 'ground_idle')"],
      poseTypes: ["STAND", "NONE", "PORTRAIT", "PROFILE", "FLOAT"],
      quirks: ["q.bedrock_quirk('eevee', 'blink')"],
    },
    walking: {
      animations: [
        "q.look('head', 1, 1, 70, -45, 45, -45)",
        "q.bedrock('eevee', 'ground_idle')",
        "q.quadruped_walk(0.66, 1.4, 'front_leg_left', 'front_leg_right', 'back_leg_left', 'back_leg_right')",
      ],
      poseTypes: ["WALK", "SWIM"],
      quirks: ["q.bedrock_quirk('eevee', 'blink')"],
    },
  },
};
const eeveeClips = ["animation.eevee.blink", "animation.eevee.cry", "animation.eevee.ground_idle", "animation.eevee.pose"];

describe("poser call parsing", () => {
  it("splits names and arguments", () => {
    expect(parsePoserCall("q.look('head', 1, 1, 70, -45, 45, -45)")).toEqual({
      name: "q.look",
      args: ["head", 1, 1, 70, -45, 45, -45],
    });
    expect(parsePoserCall("q.look")).toEqual({ name: "q.look", args: [] });
    expect(parsePoserCall("q.bedrock_primary('cube', 'faint', q.curve('one'))")).toEqual({
      name: "q.bedrock_primary",
      args: ["cube", "faint", "one"],
    });
    expect(parsePoserCall("q.bedrock_quirk('blastoise', q.array('quirk_a', 'quirk_b'), 30, 60, 1)")).toEqual({
      name: "q.bedrock_quirk",
      args: ["blastoise", "quirk_a", 30, 60, 1],
    });
    expect(parsePoserCall("nonsense")).toBeUndefined();
  });

  it("turns q.bedrock calls into clip names", () => {
    expect(clipNameFromExpression("q.bedrock('eevee', 'ground_idle')")).toBe("animation.eevee.ground_idle");
    expect(clipNameFromExpression("q.bedrock_stateful('eevee','cry')")).toBe("animation.eevee.cry");
    expect(clipNameFromExpression("q.bedrock_primary('cube', 'faint', q.curve('one'))")).toBe("animation.cube.faint");
    expect(clipNameFromExpression("q.look('head')")).toBeUndefined();
  });

  it("reads built-ins with their defaults", () => {
    expect(proceduralFromExpression("q.look('head')")).toEqual({
      kind: "look",
      bone: "head",
      pitchMultiplier: 1,
      yawMultiplier: 1,
      maxPitch: 70,
      minPitch: -45,
      maxYaw: 45,
      minYaw: -45,
    });
    expect(proceduralFromExpression("q.quadruped_walk(0.66, 1.4, 'fl', 'fr', 'bl', 'br')")).toEqual({
      kind: "quadruped_walk",
      period: 0.66,
      amplitude: 1.4,
      legs: ["fl", "fr", "bl", "br"],
    });
    expect(proceduralFromExpression("q.biped_walk(0.66, 0.6, 'leg_left', 'leg_right')")).toEqual({
      kind: "biped_walk",
      period: 0.66,
      amplitude: 0.6,
      legs: ["leg_left", "leg_right"],
    });
    expect(proceduralFromExpression("q.sine_wing_flap(1, 1, 0.5, 'z', 'wing_left', 'wing_right')")).toMatchObject({
      kind: "sine_wing_flap",
      axis: "z",
      wings: ["wing_left", "wing_right"],
    });
    expect(proceduralFromExpression("q.something_new('x')")).toEqual({
      kind: "unknown",
      name: "q.something_new",
      expr: "q.something_new('x')",
    });
  });
});

describe("readPoser", () => {
  it("builds a layer stack per activity for the cube", () => {
    const map = readPoser(poser, clipNames);
    expect(map.poses.idle).toEqual({
      clips: ["animation.cube.ground_idle"],
      procedural: [expect.objectContaining({ kind: "look", bone: "head" })],
    });
    expect(map.poses.walk?.clips).toEqual(["animation.cube.ground_walk"]);
    expect(map.poses.walk?.procedural.map((p) => p.kind)).toEqual(["look", "quadruped_walk"]);
    expect(map.poses.sleep?.clips).toEqual(["animation.cube.sleep"]);
    expect(map.cry).toBe("animation.cube.cry");
    expect(map.faint).toBe("animation.cube.faint");
    expect(map.poses.swim).toBeUndefined();
    expect(map.quirks).toEqual(["animation.cube.blink"]);
  });

  it("reads the real Eevee poser, whose walk is idle plus a procedural swing", () => {
    const map = readPoser(eeveePoser, eeveeClips);
    expect(map.poses.idle?.clips).toEqual(["animation.eevee.ground_idle"]);
    expect(map.poses.walk?.clips).toEqual(["animation.eevee.ground_idle"]);
    expect(map.poses.walk?.procedural).toEqual([
      expect.objectContaining({ kind: "look", maxPitch: 70, minPitch: -45 }),
      expect.objectContaining({
        kind: "quadruped_walk",
        period: 0.66,
        amplitude: 1.4,
        legs: ["front_leg_left", "front_leg_right", "back_leg_left", "back_leg_right"],
      }),
    ]);
    expect(map.poses.swim).toEqual(map.poses.walk);
    expect(map.cry).toBe("animation.eevee.cry");
    expect(map.faint).toBeUndefined();
    expect(map.quirks).toEqual(["animation.eevee.blink"]);
  });

  it("falls back along the chain for missing activities", () => {
    const map = readPoser(poser, clipNames);
    expect(resolveActivity(map, "swim")).toBe(map.poses.walk);
    expect(resolveActivity(map, "fly")).toBe(map.poses.walk);
    expect(resolveActivity(map, "faint")).toBe(map.poses.sleep);
    expect(resolveActivity(map, "idle")).toBe(map.poses.idle);
    expect(resolveActivity(readPoser({ poses: {} }), "walk")).toBeUndefined();
  });

  it("drops clips the animation file does not have", () => {
    const map = readPoser(poser, ["animation.cube.ground_idle"]);
    expect(map.poses.walk?.clips).toEqual([]);
    expect(map.poses.walk?.procedural.length).toBeGreaterThan(0);
    expect(map.cry).toBeUndefined();
  });

  it("tolerates a species prefix mismatch", () => {
    const map = readPoser(poser, ["animation.cube_shiny.ground_idle"]);
    expect(map.poses.idle?.clips).toEqual(["animation.cube_shiny.ground_idle"]);
  });
});

describe("battle poses", () => {
  it("prefers the overworld pose when a battle pose shares the STAND type, even when listed first", () => {
    const poser = {
      poses: {
        "battle-standing": { poseTypes: ["STAND"], isBattle: true, animations: ["q.bedrock('pika', 'battle_idle')"] },
        standing: { poseTypes: ["STAND", "NONE"], isBattle: false, animations: ["q.bedrock('pika', 'ground_idle')"] },
        quirky: { poseTypes: ["SLEEP"], isBattle: "true" as unknown as boolean, animations: ["q.bedrock('pika', 'battle_sleep')"] },
      },
    } as unknown as PoserFile;
    const map = readPoser(poser, ["animation.pika.battle_idle", "animation.pika.ground_idle", "animation.pika.battle_sleep"]);
    expect(map.poses.idle?.clips).toEqual(["animation.pika.ground_idle"]);
    // A battle pose is still used when it is the only one carrying the type.
    expect(map.poses.sleep?.clips).toEqual(["animation.pika.battle_sleep"]);
  });
});
