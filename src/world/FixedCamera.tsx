"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWorldState } from "./WorldContext";

/**
 * The home-screen camera: low, close, a little above the creature's eye
 * line, creature in the lower middle, scene running back along -Z. It is
 * fixed for a given creature height; a shorter pokemon brings it lower and
 * nearer so the framing on screen stays the same. Portrait gets a taller
 * field of view than landscape so the creature stays about the same size
 * on screen either way.
 */
export const CAMERA = {
  /** Where the creature stands when the shot was composed. */
  subject: new THREE.Vector3(0.5, 0, 1.5),
  /** The height the numbers below were tuned for. */
  referenceHeight: 0.9,
  portraitFov: 52,
  landscapeFov: 34,
};

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export function cameraFov(aspect: number): number {
  const t = THREE.MathUtils.clamp((aspect - 0.7) / (1.5 - 0.7), 0, 1);
  return THREE.MathUtils.lerp(CAMERA.portraitFov, CAMERA.landscapeFov, t);
}

/** Camera placement for a creature of the given height and a viewport aspect. */
export function cameraPose(height: number, aspect: number): CameraPose {
  const t = THREE.MathUtils.clamp((aspect - 0.7) / (1.5 - 0.7), 0, 1);
  // Scale distance and elevation with height, but never get so close to a
  // tiny creature that the lawn fills the frame.
  const h = Math.max(0.55, Math.min(1.6, height));
  const k = h / CAMERA.referenceHeight;
  const s = CAMERA.subject;
  // Portrait sees a narrow wedge, so the camera sits almost straight behind
  // the subject; the three-quarter look comes from the creature's own facing.
  const position = new THREE.Vector3(s.x + 0.35 * k, 0.3 + 0.8 * k, s.z + 1.3 + 1.7 * k);
  const targetY = THREE.MathUtils.lerp(0.25 + 0.7 * k, 0.2 + 0.55 * k, t);
  const target = new THREE.Vector3(s.x + 0.05 * k, targetY, s.z - 6);
  return { position, target, fov: cameraFov(aspect) };
}

function applyPose(camera: THREE.Camera, pose: CameraPose): void {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  camera.fov = pose.fov;
  camera.near = 0.1;
  camera.far = 80;
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
}

export function FixedCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { focusHeight } = useWorldState();

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    applyPose(camera, cameraPose(focusHeight, aspect));
  }, [camera, size.width, size.height, focusHeight]);

  return null;
}
