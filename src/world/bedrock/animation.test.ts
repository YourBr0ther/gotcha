import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import cubeAnim from "../fixtures/cube.animation.json";
import cubeGeo from "../fixtures/cube.geo.json";
import { buildClip, buildClips, createClipLibrary, parseChannel, sampleChannel, SAMPLE_HZ } from "./animation";
import { buildModel } from "./geometry";
import { resetMolangWarnings } from "./molang";
import type { BedrockAnimationFile, BedrockGeometryFile } from "./types";

const file = cubeAnim as unknown as BedrockAnimationFile;
const DEG = Math.PI / 180;

function expectTimes(times: ArrayLike<number>, expected: number[]) {
  expect(times.length).toBe(expected.length);
  expected.forEach((t, i) => expect(times[i]).toBeCloseTo(t, 5));
}

function track(clip: THREE.AnimationClip, name: string): THREE.KeyframeTrack {
  const t = clip.tracks.find((tr) => tr.name === name);
  if (!t) throw new Error(`no track ${name} in ${clip.tracks.map((x) => x.name).join(", ")}`);
  return t;
}

describe("parseChannel", () => {
  it("turns a constant vector into one keyframe", () => {
    const frames = parseChannel([1, 2, 3], "rotation");
    expect(frames).toHaveLength(1);
    expect(frames[0].time).toBe(0);
    expect(frames[0].post).toEqual([1, 2, 3]);
  });

  it("expands a scalar scale to all axes", () => {
    expect(parseChannel(2, "scale")[0].post).toEqual([2, 2, 2]);
  });

  it("sorts keyframes and keeps pre/post", () => {
    const frames = parseChannel(
      { "1.0": [1, 1, 1], "0.0": { pre: [0, 0, 0], post: [5, 5, 5] } },
      "position",
    );
    expect(frames.map((f) => f.time)).toEqual([0, 1]);
    expect(frames[0].pre).toEqual([0, 0, 0]);
    expect(frames[0].post).toEqual([5, 5, 5]);
  });
});

describe("sampleChannel", () => {
  it("interpolates linearly between numeric keyframes", () => {
    const frames = parseChannel({ "0.0": [0, 0, 0], "1.0": [10, 20, 30] }, "rotation");
    expect(sampleChannel(frames, 0.5)).toEqual([5, 10, 15]);
    expect(sampleChannel(frames, -1)).toEqual([0, 0, 0]);
    expect(sampleChannel(frames, 2)).toEqual([10, 20, 30]);
  });

  it("evaluates Molang at the sample time", () => {
    const frames = parseChannel([0, "math.sin(q.anim_time * 90) * 2", 0], "position");
    expect(sampleChannel(frames, 1)[1]).toBeCloseTo(2);
    expect(sampleChannel(frames, 0)[1]).toBeCloseTo(0);
  });

  it("passes through catmullrom keyframes", () => {
    const frames = parseChannel(
      {
        "0.0": [0, 0, 0],
        "0.5": { post: [0, 15, 0], lerp_mode: "catmullrom" },
        "1.5": { post: [0, -15, 0], lerp_mode: "catmullrom" },
        "2.0": [0, 0, 0],
      },
      "rotation",
    );
    expect(sampleChannel(frames, 0.5)[1]).toBeCloseTo(15);
    expect(sampleChannel(frames, 1.5)[1]).toBeCloseTo(-15);
    expect(sampleChannel(frames, 1.0)[1]).toBeCloseTo(0, 5);
    // between keys it stays within the overshoot you expect from a spline
    expect(Math.abs(sampleChannel(frames, 0.25)[1])).toBeLessThan(16);
  });
});

describe("buildClip", () => {
  beforeEach(() => resetMolangWarnings());
  afterEach(() => vi.restoreAllMocks());

  it("keeps exact keyframe times for numeric channels and applies the rotation convention", () => {
    const { clip, loop } = buildClip("animation.cube.ground_walk", file.animations["animation.cube.ground_walk"]);
    expect(loop).toBe("repeat");
    expect(clip.blendMode).toBe(THREE.AdditiveAnimationBlendMode);
    expect(clip.duration).toBeCloseTo(0.6667);
    const rx = track(clip, "head.rotation[x]");
    expectTimes(rx.times, [0, 0.3333, 0.6667]);
    // Bedrock -8 degrees on X becomes +8 degrees in three.js
    expect(rx.values[0]).toBeCloseTo(8 * DEG);
    expect(rx.values[1]).toBeCloseTo(-8 * DEG);
  });

  it("samples Molang channels at 20 Hz", () => {
    const { clip } = buildClip("animation.cube.ground_walk", file.animations["animation.cube.ground_walk"]);
    const pos = track(clip, "body.position");
    const expectedCount = Math.round(0.6667 * SAMPLE_HZ) + 1;
    expect(pos.times.length).toBe(expectedCount);
    expect(pos.times[1]).toBeCloseTo(1 / SAMPLE_HZ);
    // t = 0.15 -> sin(81 deg) * 1.5 on Y
    const i = 3;
    expect(pos.times[i]).toBeCloseTo(0.15);
    expect(pos.values[i * 3 + 1]).toBeCloseTo(Math.abs(Math.sin(81 * DEG)) * 1.5);
    const rz = track(clip, "body.rotation[z]");
    expect(rz.values[i]).toBeCloseTo(Math.sin(81 * DEG) * 6 * DEG);
  });

  it("mirrors X on position deltas and stores scale as a delta from one", () => {
    const { clip, loop } = buildClip("animation.cube.faint", file.animations["animation.cube.faint"]);
    expect(loop).toBe("hold");
    const pos = track(clip, "body.position");
    expectTimes(pos.times, [0, 0.7, 1.0]);
    expect(pos.values[3]).toBeCloseTo(2);
    expect(pos.values[6]).toBeCloseTo(2.5);

    const blink = buildClip("animation.cube.blink", file.animations["animation.cube.blink"]);
    expect(blink.loop).toBe("once");
    const scale = track(blink.clip, "head.scale");
    expect(scale.values[0]).toBeCloseTo(0);
    expect(scale.values[4]).toBeCloseTo(-0.2);
  });

  it("falls back to zero and warns once for unsupported Molang", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { clip } = buildClip("animation.cube.unsupported", file.animations["animation.cube.unsupported"]);
    buildClip("animation.cube.unsupported", file.animations["animation.cube.unsupported"]);
    const rx = track(clip, "head.rotation[x]");
    expect(Array.from(rx.values).every((v) => v === 0)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("q.is_on_ground");
  });

  it("derives length from keyframes when animation_length is missing", () => {
    const { clip } = buildClip("x", { bones: { head: { rotation: { "0.0": [0, 0, 0], "1.25": [1, 1, 1] } } } });
    expect(clip.duration).toBeCloseTo(1.25);
  });

  it("loops a lengthless Molang idle over a whole number of its periods instead of one sample", () => {
    // Cobblemon's breathing idles: sine waves over anim_time * 90 * k degrees, no animation_length.
    const breathe = { loop: true, bones: { body: { rotation: ["2.5-math.cos(q.anim_time*90*2-120)*2", 0, "0-math.cos(q.anim_time*90*2/2-120)*1"] } } };
    const { clip } = buildClip("x", breathe as never);
    // k = 2 has a 2 s period, k = 1 (the /2 term) a 4 s period: 4 s is the first seamless loop.
    expect(clip.duration).toBe(4);
    const rx = track(clip, "body.rotation[x]");
    expect(rx.times.length).toBe(4 * SAMPLE_HZ + 1);
    // The wave actually moves: the value a quarter period in differs from the start.
    expect(Math.abs(rx.values[10] - rx.values[0])).toBeGreaterThan(0.01);
    // And it closes: the last sample equals the first.
    expect(rx.values[rx.values.length - 1]).toBeCloseTo(rx.values[0], 4);
  });

  it("leaves a lengthless one-shot Molang clip at its keyframe length", () => {
    const { clip } = buildClip("x", { loop: false, bones: { body: { rotation: ["math.sin(q.anim_time*90)", 0, 0] } } } as never);
    expect(clip.duration).toBeCloseTo(1 / SAMPLE_HZ);
  });

  it("falls back to the longest candidate when no loop closes", () => {
    const { clip } = buildClip("x", { loop: true, bones: { body: { rotation: ["math.sin(q.anim_time*90*0.7)", 0, 0] } } } as never);
    expect(clip.duration).toBe(16);
  });
});

describe("clips driving the synthetic cube", () => {
  it("adds deltas onto the rest pose through the mixer", () => {
    const model = buildModel(cubeGeo as unknown as BedrockGeometryFile, new THREE.MeshBasicMaterial());
    const clips = buildClips(file);
    expect([...clips.keys()]).toContain("animation.cube.ground_idle");

    const mixer = new THREE.AnimationMixer(model.root);
    const action = mixer.clipAction(clips.get("animation.cube.sleep")!.clip);
    action.play();
    mixer.update(0.5);

    const head = model.bones.get("head")!;
    const rest = model.restPose.get("head")!;
    // sleep adds +35 degrees X in Bedrock -> -35 degrees here, on top of the rest 10 -> -10
    expect(head.rotation.x).toBeCloseTo(rest.rotation.x - 35 * DEG);
    expect(head.rotation.z).toBeCloseTo(rest.rotation.z);
    expect(head.position.y).toBeCloseTo(rest.position.y - 1);
    expect(head.position.z).toBeCloseTo(rest.position.z + 0.5);

    const body = model.bones.get("body")!;
    expect(body.position.y).toBeCloseTo(model.restPose.get("body")!.position.y - 1.5);
    expect(body.scale.x).toBeCloseTo(1);
    expect(body.scale.y).toBeCloseTo(0.96 + Math.sin(60 * DEG) * 0.03, 2);
  });
});

describe("createClipLibrary", () => {
  it("knows every name up front but samples a clip only on first use", () => {
    const prepared: string[] = [];
    const lib = createClipLibrary(file, (clip) => prepared.push(clip.name));
    expect(lib.names()).toEqual(Object.keys(file.animations));
    expect(lib.has("animation.cube.sleep")).toBe(true);
    expect(lib.built).toBe(0);
    const sleep = lib.get("animation.cube.sleep");
    expect(sleep?.clip.tracks.length).toBeGreaterThan(0);
    expect(lib.built).toBe(1);
    expect(prepared).toEqual(["animation.cube.sleep"]);
    expect(lib.get("animation.cube.sleep")).toBe(sleep);
    expect(lib.built).toBe(1);
  });

  it("prebuilds a list and skips names the file lacks", () => {
    const lib = createClipLibrary(file);
    lib.prebuild(["animation.cube.ground_idle", "animation.cube.nope"]);
    expect(lib.built).toBe(1);
    expect(lib.get("animation.cube.nope")).toBeUndefined();
  });
});
