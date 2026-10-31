import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import cubeAnim from "../fixtures/cube.animation.json";
import cubeGeo from "../fixtures/cube.geo.json";
import cubePoser from "../fixtures/cube.poser.json";
import { createClipLibrary } from "../bedrock/animation";
import { buildModel } from "../bedrock/geometry";
import { EMPTY_ATLAS, type ParticleDefinitionFile, parseParticleDefinition } from "../bedrock/particles";
import { readPoser } from "../bedrock/poser";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "../bedrock/types";
import { getDiorama } from "../dioramas";
import { CreatureRig, type LoadedCreature, startBaseAction } from "./rig";

/** A synthetic steady smoke, in the shape of the jar's idle effects. */
const SMOKE: ParticleDefinitionFile = {
  particle_effect: {
    description: { identifier: "test:cube_smoke" },
    components: {
      "minecraft:emitter_lifetime_expression": { activation_expression: 1 },
      "minecraft:emitter_rate_steady": { spawn_rate: 20, max_particles: 10 },
      "minecraft:emitter_shape_point": {},
      "minecraft:particle_lifetime_expression": { max_lifetime: 0.3 },
    },
  },
};

/** A synthetic burst, in the shape of the jar's faint sparks. */
const SPARKS: ParticleDefinitionFile = {
  particle_effect: {
    description: { identifier: "test:cube_sparks" },
    components: {
      "minecraft:emitter_lifetime_once": { active_time: 0.5 },
      "minecraft:emitter_rate_instant": { num_particles: 6 },
      "minecraft:particle_lifetime_expression": { max_lifetime: 0.2 },
    },
  },
};

interface FixtureOptions {
  /** Attach the smoke to the idle clip, the sparks to the faint clip, or both. */
  withParticles?: "idle" | "faint" | "both";
}

/** The synthetic cube as a loaded creature, optionally without its sleep pose. */
function loadFixture(withSleep: boolean, options: FixtureOptions = {}): LoadedCreature {
  const material = new THREE.MeshBasicMaterial();
  const model = buildModel(cubeGeo as unknown as BedrockGeometryFile, material);
  const animations = JSON.parse(JSON.stringify(cubeAnim)) as BedrockAnimationFile;
  const fx = options.withParticles;
  if (fx === "idle" || fx === "both") animations.animations["animation.cube.ground_idle"].particle_effects = { "0.0": { effect: "cube_smoke", locator: "nose" } };
  if (fx === "faint" || fx === "both") {
    animations.animations["animation.cube.faint"].particle_effects = { "0.1": [{ effect: "cube_sparks" }, { effect: "cube_sparks" }], "0.3": "cobblemon:cube_handler" };
  }
  const poserFile = JSON.parse(JSON.stringify(cubePoser)) as PoserFile;
  // A species without a sleep clip: drop the pose and the clip, since a
  // clip named sleep would be picked up by name even with the pose gone.
  if (!withSleep) {
    delete poserFile.poses?.sleeping;
    delete animations.animations["animation.cube.sleep"];
  }
  const clips = createClipLibrary(animations);
  const poser = readPoser(poserFile, clips.names());
  return {
    model,
    clips,
    poser,
    texture: null,
    emissive: null,
    material,
    bundle: { species: "cube", geometry: cubeGeo as unknown as BedrockGeometryFile, animations, poser: poserFile, textures: { base: "" } },
    meshes: 0,
    particles: fx ? { effects: new Map([["cube_smoke", parseParticleDefinition(SMOKE)], ["cube_sparks", parseParticleDefinition(SPARKS)]]), atlas: EMPTY_ATLAS } : undefined,
    dispose() {
      model.dispose();
      material.dispose();
    },
  };
}

function tick(rig: CreatureRig, seconds: number, step = 1 / 30) {
  for (let t = 0; t < seconds; t += step) rig.update(step);
}

describe("procedural sleep", () => {
  it("rolls a species without a sleep clip onto its side, slows its idle, and gets up again on idle", () => {
    const loaded = loadFixture(false);
    const rig = new CreatureRig(loaded, getDiorama("meadow"));
    const body = rig.group.children[0] as THREE.Group;
    const standingY = body.position.y;
    expect(rig.lyingDown).toBe(false);
    rig.play("sleep");
    expect(rig.currentActivity).toBe("sleep");
    expect(rig.lyingDown).toBe(true);
    tick(rig, 0.4);
    expect(rig.sleepProgress).toBeGreaterThan(0.2);
    expect(rig.sleepProgress).toBeLessThan(0.8);
    tick(rig, 1);
    expect(rig.sleepProgress).toBe(1);
    expect(Math.abs(body.rotation.z)).toBeGreaterThan(Math.PI / 3);
    expect(body.position.y).toBeLessThan(standingY);
    const idle = loaded.clips.get("animation.cube.ground_idle")!.clip;
    expect(rig.mixer.existingAction(idle)?.getEffectiveTimeScale()).toBeCloseTo(0.3);

    rig.play("idle");
    expect(rig.lyingDown).toBe(false);
    tick(rig, 1.2);
    expect(rig.sleepProgress).toBe(0);
    expect(body.rotation.z).toBe(0);
    expect(body.position.y).toBeCloseTo(standingY);
    expect(rig.mixer.existingAction(idle)?.getEffectiveTimeScale()).toBe(1);
  });

  it("leaves a species with a real sleep clip standing in its own pose", () => {
    const rig = new CreatureRig(loadFixture(true), getDiorama("meadow"));
    rig.play("sleep");
    expect(rig.lyingDown).toBe(false);
    tick(rig, 1.2);
    expect(rig.sleepProgress).toBe(0);
  });

  it("stands up when sent walking", () => {
    const rig = new CreatureRig(loadFixture(false), getDiorama("meadow"));
    rig.play("sleep");
    tick(rig, 1.2);
    void rig.moveTo("forage_1");
    expect(rig.lyingDown).toBe(false);
  });
});

function setup() {
  const root = new THREE.Object3D();
  root.name = "root";
  const bone = new THREE.Object3D();
  bone.name = "bone";
  root.add(bone);
  const track = new THREE.NumberKeyframeTrack("bone.rotation[x]", [0, 1], [0.5, 0.5]);
  const clip = new THREE.AnimationClip("pose", 1, [track], THREE.AdditiveAnimationBlendMode);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  return { mixer, action, bone };
}

describe("startBaseAction", () => {
  it("fades a clip in to full weight, so the pose actually shows", () => {
    const { mixer, action, bone } = setup();
    startBaseAction(action, false, 0.25);
    expect(action.getEffectiveWeight()).toBe(1);
    mixer.update(0.05);
    const early = action.getEffectiveWeight();
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    mixer.update(0.5);
    expect(action.getEffectiveWeight()).toBeCloseTo(1, 5);
    expect(bone.rotation.x).toBeCloseTo(0.5, 5);
  });

  it("shows the pose at once when immediate", () => {
    const { mixer, action, bone } = setup();
    startBaseAction(action, true);
    mixer.update(0.016);
    expect(action.getEffectiveWeight()).toBe(1);
    expect(bone.rotation.x).toBeCloseTo(0.5, 5);
  });

  it("recovers a clip that was fading out", () => {
    const { mixer, action } = setup();
    startBaseAction(action, true);
    mixer.update(0.1);
    action.fadeOut(0.25);
    mixer.update(0.2);
    expect(action.getEffectiveWeight()).toBeLessThan(0.5);
    startBaseAction(action, false, 0.25);
    mixer.update(0.5);
    expect(action.getEffectiveWeight()).toBeCloseTo(1, 5);
    expect(action.isRunning()).toBe(true);
  });
});

describe("particle effects on clips", () => {
  it("runs a steady emitter while the idle plays and stops it when the idle fades out", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loaded = loadFixture(true, { withParticles: "idle" });
    const rig = new CreatureRig(loaded, getDiorama("meadow"));
    expect(rig.particleCount).toBe(0);
    tick(rig, 0.5);
    expect(rig.particleCount).toBeGreaterThan(0);
    expect(rig.activeEmitters).toEqual(["cube_smoke"]);
    expect(rig.particleDrawCalls).toBe(1);
    // The idle fades out over a quarter second; once it is below half weight the emitter stops and the smoke drains.
    rig.play("sleep");
    tick(rig, 1);
    expect(rig.particleCount).toBe(0);
    expect(rig.activeEmitters).toEqual([]);
    expect(rig.particleDrawCalls).toBe(0);
    // Back to idle, the smoke starts again.
    rig.play("idle");
    tick(rig, 0.6);
    expect(rig.particleCount).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("fires a one-shot when the faint clip crosses its keyframe, once per entry, and skips code-side handlers with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loaded = loadFixture(true, { withParticles: "faint" });
    const rig = new CreatureRig(loaded, getDiorama("meadow"));
    rig.play("faint");
    tick(rig, 0.05);
    expect(rig.activeEmitters.filter((id) => id === "cube_sparks")).toHaveLength(0);
    tick(rig, 0.1);
    expect(rig.activeEmitters.filter((id) => id === "cube_sparks")).toHaveLength(2);
    expect(rig.particleCount).toBe(12);
    tick(rig, 1);
    expect(rig.particleCount).toBe(0);
    expect(rig.activeEmitters).toEqual([]);
    const handlerWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("cube_handler"));
    expect(handlerWarnings).toHaveLength(1);
    warn.mockRestore();
  });

  it("costs nothing for a species without effects", () => {
    const rig = new CreatureRig(loadFixture(true), getDiorama("meadow"));
    tick(rig, 0.5);
    expect(rig.particleCount).toBe(0);
    expect(rig.effects.children).toHaveLength(0);
  });
});
