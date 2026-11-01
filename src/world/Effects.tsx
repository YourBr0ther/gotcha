"use client";

import { useMemo } from "react";
import { Bloom, DepthOfField, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { getDiorama } from "./dioramas";
import { useWorldState } from "./WorldContext";

/**
 * The post chain behind `World`'s `depth` prop: anti-aliasing, a bloom that
 * only the sun disc, water highlights and crystals cross, depth of field
 * focused on the creature so the far trees soften (the range reaches the
 * ground a wild visitor wanders, so it stays readable), and a light vignette.
 * Half resolution for the blur passes. The composer renders through R3F's
 * frame loop, so pausing the canvas pauses it too.
 */
export function Effects() {
  const { focus, focusHeight, diorama } = useWorldState();
  const target = useMemo(() => {
    const s = focus ?? { ...getDiorama(diorama).framing.subject, y: 0 };
    return new THREE.Vector3(s.x, s.y + focusHeight * 0.45, s.z);
  }, [focus, focusHeight, diorama]);

  return (
    <EffectComposer multisampling={0} resolutionScale={1} enableNormalPass={false}>
      <SMAA />
      <DepthOfField target={target} focusRange={5.5} bokehScale={2.6} resolutionScale={0.5} />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.25} intensity={0.55} radius={0.7} levels={6} />
      <Vignette offset={0.28} darkness={0.48} />
    </EffectComposer>
  );
}
