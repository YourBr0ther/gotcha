import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ProceduralStack } from "./layers";

function rig(names: string[]) {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Object3D>();
  for (const n of names) {
    const g = new THREE.Group();
    g.name = n;
    g.rotation.order = "ZYX";
    root.add(g);
    bones.set(n, g);
  }
  return { root, bones };
}

describe("procedural layers", () => {
  it("swings diagonal legs together and the other pair opposite", () => {
    const { root, bones } = rig(["fl", "fr", "bl", "br"]);
    const stack = new ProceduralStack(bones, root, [
      { kind: "quadruped_walk", period: 0.66, amplitude: 1.4, legs: ["fl", "fr", "bl", "br"] },
    ]);
    // Run at full speed long enough for the swing amount to settle.
    for (let i = 0; i < 60; i++) {
      stack.restore();
      stack.apply({ dt: 1 / 60, speed: 6, lookTarget: null });
    }
    const fl = bones.get("fl")!.rotation.x;
    const fr = bones.get("fr")!.rotation.x;
    const bl = bones.get("bl")!.rotation.x;
    const br = bones.get("br")!.rotation.x;
    expect(fl).toBeCloseTo(br);
    expect(fr).toBeCloseTo(bl);
    expect(fl).toBeCloseTo(-fr);
    expect(Math.abs(fl)).toBeGreaterThan(0.05);
    expect(stack.walkState.amount).toBeCloseTo(1, 1);
  });

  it("eases to no swing when standing still and restores cleanly", () => {
    const { root, bones } = rig(["l", "r"]);
    const stack = new ProceduralStack(bones, root, [{ kind: "biped_walk", period: 0.66, amplitude: 1.4, legs: ["l", "r"] }]);
    for (let i = 0; i < 30; i++) {
      stack.restore();
      stack.apply({ dt: 1 / 60, speed: 6, lookTarget: null });
    }
    expect(Math.abs(bones.get("l")!.rotation.x)).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++) {
      stack.restore();
      stack.apply({ dt: 1 / 60, speed: 0, lookTarget: null });
    }
    expect(Math.abs(bones.get("l")!.rotation.x)).toBeLessThan(1e-3);
    stack.restore();
    expect(bones.get("l")!.rotation.x).toBeCloseTo(0);
    expect(bones.get("r")!.rotation.x).toBeCloseTo(0);
  });

  it("does not accumulate across frames when the clip output is unchanged", () => {
    const { root, bones } = rig(["l", "r"]);
    bones.get("l")!.rotation.x = 0.3; // pretend the clip put the leg here
    const stack = new ProceduralStack(bones, root, [{ kind: "biped_walk", period: 0.66, amplitude: 1.4, legs: ["l", "r"] }]);
    for (let i = 0; i < 100; i++) {
      stack.restore();
      stack.apply({ dt: 1 / 60, speed: 6, lookTarget: null });
      expect(Math.abs(bones.get("l")!.rotation.x - 0.3)).toBeLessThanOrEqual(1.4 + 1e-6);
    }
  });

  it("turns the head toward a target and clamps to the poser limits", () => {
    const { root, bones } = rig(["head"]);
    bones.get("head")!.position.set(0, 1, 0);
    const stack = new ProceduralStack(bones, root, [
      { kind: "look", bone: "head", pitchMultiplier: 1, yawMultiplier: 1, maxPitch: 70, minPitch: -45, maxYaw: 45, minYaw: -45 },
    ]);
    // Target at +X, level with the head: a 90 degree turn (Bedrock +90) clamped to 45.
    const target = new THREE.Vector3(5, 1, 0);
    for (let i = 0; i < 120; i++) {
      stack.restore();
      stack.apply({ dt: 1 / 60, speed: 0, lookTarget: target });
    }
    const state = stack.lookState("head")!;
    expect(state.yaw).toBeCloseTo(45, 0);
    // Bedrock yaw +45 becomes -45 degrees about three.js Y: the front swings toward +X.
    const head = bones.get("head")!;
    const front = new THREE.Vector3(0, 0, -1).applyEuler(head.rotation);
    expect(front.x).toBeGreaterThan(0.6);

    // Straight down below the head: pitch clamps at 70 (looking down).
    target.set(0, -5, -0.01);
    for (let i = 0; i < 120; i++) {
      stack.restore();
      stack.apply({ dt: 1 / 60, speed: 0, lookTarget: target });
    }
    expect(state.pitch).toBeCloseTo(70, 0);
    const down = new THREE.Vector3(0, 0, -1).applyEuler(head.rotation);
    expect(down.y).toBeLessThan(-0.8);
  });
});
