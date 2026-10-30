import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { startBaseAction } from "./rig";

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
