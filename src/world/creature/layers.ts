/**
 * Procedural pose layers: Cobblemon's poser built-ins computed each frame
 * and added onto whatever the keyframe clips produced.
 *
 * Layers are applied after the mixer and undone before it runs again, so
 * they stack on the clip output without the mixer's change detection
 * letting a delta pile up frame over frame.
 *
 * Parameter meanings assumed from vanilla Minecraft's quadruped model,
 * which Cobblemon's built-ins follow:
 *   - `period` multiplies the limb-swing counter (0.6662 in vanilla), where
 *     the counter advances by the swing amount once per tick (20 Hz);
 *   - `amplitude` is the leg rotation in radians at full speed (1.4 vanilla);
 *   - the swing amount is min(1, blocks per tick * 4), eased toward.
 * Front-left and back-right legs share a phase; the other pair is opposite.
 * Arms swing opposite to the leg on the same side.
 */

import * as THREE from "three";
import type { ProceduralSpec } from "../bedrock/poser";
import { warnOnce } from "../bedrock/molang";

const DEG = Math.PI / 180;
const TICKS = 20;

export interface LayerInput {
  dt: number;
  /** Ground speed in blocks per second. */
  speed: number;
  /** World-space point the creature is looking at, or null to look ahead. */
  lookTarget: THREE.Vector3 | null;
}

interface AppliedDelta {
  bone: THREE.Object3D;
  x: number;
  y: number;
  z: number;
}

/** Limb swing shared by every walk-style layer in a stack. */
export class WalkState {
  phase = 0;
  amount = 0;

  advance(period: number, speed: number, dt: number): void {
    const target = Math.min(1, (speed / TICKS) * 4);
    const k = Math.min(1, dt * 10);
    this.amount += (target - this.amount) * k;
    this.phase += this.amount * period * TICKS * dt;
  }

  /** Bedrock X rotation in radians for a limb at a phase offset. */
  swing(amplitude: number, offset: number): number {
    return Math.cos(this.phase + offset) * amplitude * this.amount;
  }
}

export interface LookState {
  pitch: number;
  yaw: number;
}

export class ProceduralStack {
  private applied: AppliedDelta[] = [];
  private readonly walk = new WalkState();
  private readonly look = new Map<string, LookState>();
  private readonly scratch = {
    target: new THREE.Vector3(),
    origin: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    inverse: new THREE.Matrix4(),
  };

  constructor(
    private readonly bones: Map<string, THREE.Object3D>,
    private readonly root: THREE.Object3D,
    private readonly specs: ProceduralSpec[],
  ) {
    for (const spec of specs) {
      if (spec.kind === "unknown") warnOnce(`poser:${spec.name}`, `poser built-in ${spec.name} is not implemented; ignoring "${spec.expr}"`);
      if (spec.kind === "sine_wing_flap") warnOnce("poser:q.sine_wing_flap", "q.sine_wing_flap is stubbed; wings hold still");
    }
  }

  get walkState(): WalkState {
    return this.walk;
  }

  lookState(bone: string): LookState | undefined {
    return this.look.get(bone);
  }

  /** Undo last frame's deltas. Call before the mixer updates. */
  restore(): void {
    for (const d of this.applied) {
      d.bone.rotation.x -= d.x;
      d.bone.rotation.y -= d.y;
      d.bone.rotation.z -= d.z;
    }
    this.applied.length = 0;
  }

  private add(name: string, bedrockX: number, bedrockY: number, bedrockZ: number): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    // Same sign convention as the geometry loader: X and Y negated.
    const d = { bone, x: -bedrockX, y: -bedrockY, z: bedrockZ };
    bone.rotation.x += d.x;
    bone.rotation.y += d.y;
    bone.rotation.z += d.z;
    this.applied.push(d);
  }

  /** Compute and add this frame's deltas. Call after the mixer updates. */
  apply(input: LayerInput): void {
    let walkAdvanced = false;
    for (const spec of this.specs) {
      switch (spec.kind) {
        case "quadruped_walk": {
          if (!walkAdvanced) {
            this.walk.advance(spec.period, input.speed, input.dt);
            walkAdvanced = true;
          }
          const a = this.walk.swing(spec.amplitude, 0);
          const b = this.walk.swing(spec.amplitude, Math.PI);
          this.add(spec.legs[0], a, 0, 0);
          this.add(spec.legs[1], b, 0, 0);
          this.add(spec.legs[2], b, 0, 0);
          this.add(spec.legs[3], a, 0, 0);
          break;
        }
        case "biped_walk": {
          if (!walkAdvanced) {
            this.walk.advance(spec.period, input.speed, input.dt);
            walkAdvanced = true;
          }
          this.add(spec.legs[0], this.walk.swing(spec.amplitude, 0), 0, 0);
          this.add(spec.legs[1], this.walk.swing(spec.amplitude, Math.PI), 0, 0);
          break;
        }
        case "bimanual_swing": {
          if (!walkAdvanced) {
            this.walk.advance(spec.period, input.speed, input.dt);
            walkAdvanced = true;
          }
          this.add(spec.arms[0], this.walk.swing(spec.amplitude, Math.PI), 0, 0);
          this.add(spec.arms[1], this.walk.swing(spec.amplitude, 0), 0, 0);
          break;
        }
        case "look":
          this.applyLook(spec, input);
          break;
        case "sine_wing_flap":
        case "unknown":
          break;
      }
    }
  }

  private applyLook(spec: Extract<ProceduralSpec, { kind: "look" }>, input: LayerInput): void {
    const bone = this.bones.get(spec.bone);
    if (!bone) return;
    let state = this.look.get(spec.bone);
    if (!state) {
      state = { pitch: 0, yaw: 0 };
      this.look.set(spec.bone, state);
    }
    let targetPitch = 0;
    let targetYaw = 0;
    if (input.lookTarget) {
      const s = this.scratch;
      // Direction to the target in the creature's root frame, from the bone's position.
      this.root.updateWorldMatrix(true, false);
      bone.updateWorldMatrix(true, false);
      s.origin.setFromMatrixPosition(bone.matrixWorld);
      s.inverse.copy(this.root.matrixWorld).invert();
      s.target.copy(input.lookTarget).applyMatrix4(s.inverse);
      s.origin.applyMatrix4(s.inverse);
      s.dir.subVectors(s.target, s.origin);
      const horizontal = Math.hypot(s.dir.x, s.dir.z);
      if (horizontal > 1e-4 || Math.abs(s.dir.y) > 1e-4) {
        // Model faces -Z: yaw to the left is positive about +Y.
        const yaw = Math.atan2(-s.dir.x, -s.dir.z) / DEG;
        const up = Math.atan2(s.dir.y, horizontal) / DEG;
        // Bedrock pitch is positive looking down.
        targetPitch = THREE.MathUtils.clamp(-up * spec.pitchMultiplier, spec.minPitch, spec.maxPitch);
        // Bedrock yaw is the negated three.js yaw.
        targetYaw = THREE.MathUtils.clamp(-yaw * spec.yawMultiplier, spec.minYaw, spec.maxYaw);
        // Behind the creature: give up rather than snap the neck.
        if (Math.abs(yaw) > 100) {
          targetPitch = 0;
          targetYaw = 0;
        }
      }
    }
    const k = Math.min(1, input.dt * 6);
    state.pitch += (targetPitch - state.pitch) * k;
    state.yaw += (targetYaw - state.yaw) * k;
    this.add(spec.bone, state.pitch * DEG, state.yaw * DEG, 0);
  }
}
