import { describe, expect, it } from "vitest";
import * as THREE from "three";
import cubeAnim from "../fixtures/cube.animation.json";
import cubeGeo from "../fixtures/cube.geo.json";
import cubePoser from "../fixtures/cube.poser.json";
import { createClipLibrary } from "../bedrock/animation";
import { buildModel } from "../bedrock/geometry";
import { readPoser } from "../bedrock/poser";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "../bedrock/types";
import { getDiorama } from "../dioramas";
import { CreatureRig, type LoadedCreature, startBaseAction } from "./rig";

/** The synthetic cube as a loaded creature, optionally without its sleep pose. */
function loadFixture(withSleep: boolean): LoadedCreature {
  const material = new THREE.MeshBasicMaterial();
  const model = buildModel(cubeGeo as unknown as BedrockGeometryFile, material);
  const clips = createClipLibrary(cubeAnim as unknown as BedrockAnimationFile);
  const poserFile = JSON.parse(JSON.stringify(cubePoser)) as PoserFile;
  if (!withSleep) delete poserFile.poses?.sleeping;
  const poser = readPoser(poserFile, clips.names());
  return {
    model,
    clips,
    poser,
    texture: null,
    emissive: null,
    material,
    bundle: { species: "cube", geometry: cubeGeo as unknown as BedrockGeometryFile, animations: cubeAnim as unknown as BedrockAnimationFile, poser: poserFile, textures: { base: "" } },
    meshes: 0,
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
