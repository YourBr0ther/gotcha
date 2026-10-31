import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { resetMolangWarnings } from "./molang";
import {
  type EvalContext,
  evalCurve,
  flipbookFrame,
  parseColor,
  type ParticleDefinitionFile,
  ParticleSystem,
  parseParticleDefinition,
  runMolangScript,
  sampleGradient,
  spawnPoint,
  srgbToLinear,
} from "./particles";

/** A synthetic definition in the shape of the jar's steady smoke effects. Nothing here is a Cobblemon asset. */
function smokeDefinition(): ParticleDefinitionFile {
  return {
    format_version: "1.10.0",
    particle_effect: {
      description: { identifier: "test:puff_smoke", basic_render_parameters: { material: "particles_alpha", texture: "textures/particles/puff" } },
      components: {
        "cobblemon:emitter_space": { scaling: "entity" },
        "minecraft:emitter_lifetime_expression": { activation_expression: 1 },
        "minecraft:emitter_rate_steady": { max_particles: 3, spawn_rate: 10 },
        "minecraft:emitter_shape_disc": { direction: "outwards", offset: [0, 0.15, 0], radius: "0.2 * 2", surface_only: true },
        "minecraft:particle_appearance_billboard": {
          facing_camera_mode: "rotate_xyz",
          size: ["variable.shrink", "variable.shrink"],
          uv: { flipbook: { base_UV: [0, 0], frames_per_second: 7, max_frame: 6, size_UV: [16, 16], step_UV: [0, 16] }, texture_height: 96, texture_width: 16 },
        },
        "minecraft:particle_appearance_lighting": {},
        "minecraft:particle_appearance_tinting": { color: { gradient: { "0.0": "#FFFFFFFF", "1.0": "#80000000" }, interpolant: "v.particle_age / v.particle_lifetime" } },
        "minecraft:particle_initial_speed": -0.1,
        "minecraft:particle_initial_spin": { rotation: "math.random(0,360)" },
        "minecraft:particle_lifetime_expression": { max_lifetime: 0.5 },
        "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 1, 0], linear_drag_coefficient: 2 },
        "minecraft:particle_motion_collision": { collision_radius: 0.1 },
      },
      curves: { "variable.shrink": { horizontal_range: "v.particle_lifetime", input: "v.particle_age", nodes: [0, 1, 0.5], type: "linear" } },
    },
  };
}

function burstDefinition(): ParticleDefinitionFile {
  return {
    particle_effect: {
      description: { identifier: "test:burst" },
      components: {
        "minecraft:emitter_lifetime_once": { active_time: 1 },
        "minecraft:emitter_rate_instant": { num_particles: 8 },
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_initial_speed": 2,
        "minecraft:particle_lifetime_expression": { max_lifetime: 0.3 },
      },
    },
  };
}

function ctxWith(vars: Record<string, number> = {}): EvalContext {
  return { animTime: 0, lifeTime: 0, vars, random: () => 0.5 };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetMolangWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("parseParticleDefinition", () => {
  it("reads the component set into one record and warns once per component it ignores", () => {
    const parsed = parseParticleDefinition(smokeDefinition());
    expect(parsed.id).toBe("puff_smoke");
    expect(parsed.blend).toBe("alpha");
    expect(parsed.entityScaling).toBe(true);
    expect(parsed.rate).toEqual({ kind: "steady", rate: 10, max: 3 });
    expect(parsed.lifetime).toEqual({ kind: "expression", activation: 1, expiration: 0 });
    expect(parsed.shape).toEqual({ kind: "disc", offset: [0, 0.15, 0], radius: "0.2 * 2", normal: [0, 1, 0], surfaceOnly: true, direction: "outwards" });
    expect(parsed.billboard.uv.kind).toBe("flipbook");
    expect(parsed.billboard.textureHeight).toBe(96);
    expect(parsed.tint.kind).toBe("gradient");
    expect(parsed.initialSpeed).toBe(-0.1);
    expect(parsed.maxLifetime).toBe(0.5);
    expect(parsed.dynamic.acceleration).toEqual([0, 1, 0]);
    expect(parsed.dynamic.drag).toBe(2);
    expect(parsed.curves).toEqual([{ name: "shrink", input: "v.particle_age", range: "v.particle_lifetime", nodes: [0, 1, 0.5] }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("minecraft:particle_motion_collision");
    parseParticleDefinition(smokeDefinition());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("defaults every piece of a bare definition", () => {
    const parsed = parseParticleDefinition({ particle_effect: { description: { identifier: "cobblemon:bare" } } });
    expect(parsed.rate).toEqual({ kind: "instant", count: 1 });
    expect(parsed.shape.kind).toBe("point");
    expect(parsed.billboard.uv).toEqual({ kind: "static", uv: [0, 0], uvSize: [16, 16] });
    expect(parsed.tint).toEqual({ kind: "constant", color: [1, 1, 1, 1] });
    const additive = parseParticleDefinition({ particle_effect: { description: { identifier: "x", basic_render_parameters: { material: "particles_add" } } } });
    expect(additive.blend).toBe("additive");
  });
});

describe("colour and curve maths", () => {
  it("parses #AARRGGBB and arrays into linear light", () => {
    const c = parseColor("#80FF8000")!;
    expect(c[3]).toBeCloseTo(0x80 / 255);
    expect(c[0]).toBeCloseTo(1);
    expect(c[1]).toBeCloseTo(srgbToLinear(0x80 / 255));
    expect(c[2]).toBe(0);
    expect(parseColor("#FFFFFF")).toEqual([1, 1, 1, 1]);
    expect(parseColor([1, 1, 1, 0.5])).toEqual([1, 1, 1, 0.5]);
    expect(parseColor("red")).toBeNull();
  });

  it("samples gradients between stops and clamps outside them", () => {
    const stops = [
      { t: 0, color: [0, 0, 0, 1] as [number, number, number, number] },
      { t: 0.5, color: [1, 1, 1, 1] as [number, number, number, number] },
      { t: 1, color: [1, 0, 0, 0] as [number, number, number, number] },
    ];
    const out: [number, number, number, number] = [0, 0, 0, 0];
    expect(sampleGradient(stops, 0.25, out)).toEqual([0.5, 0.5, 0.5, 1]);
    expect(sampleGradient(stops, 0.75, out)).toEqual([1, 0.5, 0.5, 0.5]);
    expect(sampleGradient(stops, -1, out)).toEqual([0, 0, 0, 1]);
    expect(sampleGradient(stops, 2, out)).toEqual([1, 0, 0, 0]);
  });

  it("interpolates evenly spaced curve nodes over the horizontal range, and keyed nodes by input", () => {
    const curve = { name: "shrink", input: "v.particle_age", range: "v.particle_lifetime", nodes: [0, 1, 0.5] };
    expect(evalCurve(curve, ctxWith({ particle_age: 0, particle_lifetime: 2 }))).toBe(0);
    expect(evalCurve(curve, ctxWith({ particle_age: 1, particle_lifetime: 2 }))).toBe(1);
    expect(evalCurve(curve, ctxWith({ particle_age: 1.5, particle_lifetime: 2 }))).toBe(0.75);
    expect(evalCurve(curve, ctxWith({ particle_age: 5, particle_lifetime: 2 }))).toBe(0.5);
    const keyed = { name: "k", input: "v.t", range: 1, nodes: [{ t: 0, value: 2 }, { t: 2, value: 4 }] };
    expect(evalCurve(keyed, ctxWith({ t: 1 }))).toBe(3);
    expect(evalCurve(keyed, ctxWith({ t: 9 }))).toBe(4);
  });

  it("steps flipbooks by fps, loops or clamps, and stretches to the lifetime", () => {
    const base = { base: [0, 0] as [number, number], size: [16, 16] as [number, number], step: [0, 16] as [number, number], fps: 10, maxFrame: 4, stretchToLifetime: false, loop: false };
    const ctx = ctxWith();
    expect(flipbookFrame(base, 0.05, 1, 4, ctx)).toBe(0);
    expect(flipbookFrame(base, 0.25, 1, 4, ctx)).toBe(2);
    expect(flipbookFrame(base, 0.9, 1, 4, ctx)).toBe(3);
    expect(flipbookFrame({ ...base, loop: true }, 0.55, 1, 4, ctx)).toBe(1);
    expect(flipbookFrame({ ...base, stretchToLifetime: true }, 0.5, 2, 4, ctx)).toBe(1);
  });

  it("runs assignment scripts into the variable table", () => {
    const ctx = ctxWith();
    runMolangScript("v.fall_acc = -0.3;v.rot_speed = math.random(-30,30); variable.Curve_Len = 15;", ctx);
    expect(ctx.vars).toEqual({ fall_acc: -0.3, rot_speed: 0, curve_len: 15 });
  });
});

describe("spawnPoint", () => {
  it("puts disc particles on the rim heading outwards, and box particles inside the box", () => {
    const offset = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const rng = () => 0.3;
    spawnPoint({ kind: "disc", offset: [0, 1, 0], radius: 2, normal: [0, 1, 0], surfaceOnly: true, direction: "outwards" }, ctxWith(), rng, offset, dir);
    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(2);
    expect(offset.y).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
    expect(dir.length()).toBeCloseTo(1);
    spawnPoint({ kind: "box", offset: [0, 0, 0], half: [1, 0, 1], surfaceOnly: false, direction: "inwards" }, ctxWith(), rng, offset, dir);
    expect(Math.abs(offset.x)).toBeLessThanOrEqual(1);
    expect(offset.y).toBe(0);
    expect(dir.dot(offset)).toBeLessThan(0);
    spawnPoint({ kind: "point", offset: [0, 0, 0], direction: null }, ctxWith(), rng, offset, dir);
    expect(dir.length()).toBeCloseTo(1);
  });
});

describe("ParticleSystem", () => {
  function tick(system: ParticleSystem, seconds: number, step = 1 / 60) {
    for (let t = 0; t < seconds - 1e-9; t += step) system.update(step);
  }

  it("fills a steady emitter up to its cap at the anchor, and drains after stop", () => {
    const system = new ParticleSystem();
    const anchor = new THREE.Object3D();
    anchor.position.set(3, 1, -2);
    const emitter = system.spawn(parseParticleDefinition(smokeDefinition()), anchor, { scale: 2, random: () => 0.5 });
    expect(emitter.scale).toBe(2);
    tick(system, 1);
    // Ten a second living half a second would be five; the cap holds it at three.
    expect(system.particleCount).toBe(3);
    expect(system.activeEmitters).toEqual(["puff_smoke"]);
    expect(system.drawCalls).toBe(1);
    const pos = (system.root.children[0] as THREE.Mesh).geometry.getAttribute("iPos") as THREE.BufferAttribute;
    const dx = pos.getX(0) - 3;
    const dz = pos.getZ(0) + 2;
    // Radius 0.4 at entity scale 2 is 0.8, drifting inward at 0.2 blocks/s against drag: just inside the rim.
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0.7);
    expect(Math.hypot(dx, dz)).toBeLessThan(0.81);
    // Offset 0.15 up, scaled, plus the upward acceleration.
    expect(pos.getY(0)).toBeGreaterThan(1.3);
    emitter.stop();
    tick(system, 0.6);
    expect(system.particleCount).toBe(0);
    expect(system.activeEmitters).toEqual([]);
    expect(system.drawCalls).toBe(0);
  });

  it("fires a burst once, lets it fly out, and forgets the emitter when the last particle dies", () => {
    const system = new ParticleSystem();
    const anchor = new THREE.Object3D();
    system.spawn(parseParticleDefinition(burstDefinition()), anchor);
    system.update(1 / 60);
    expect(system.particleCount).toBe(8);
    tick(system, 0.2);
    expect(system.particleCount).toBe(8);
    const pos = (system.root.children[0] as THREE.Mesh).geometry.getAttribute("iPos") as THREE.BufferAttribute;
    const travelled = Math.hypot(pos.getX(0), pos.getY(0), pos.getZ(0));
    expect(travelled).toBeGreaterThan(0.3);
    tick(system, 0.2);
    expect(system.particleCount).toBe(0);
    // The emitter itself lasts its active_time, as in Bedrock, then goes.
    expect(system.activeEmitters).toEqual(["burst"]);
    tick(system, 0.7);
    expect(system.activeEmitters).toEqual([]);
  });

  it("keeps local-space particles riding their locator", () => {
    const def = parseParticleDefinition({
      particle_effect: {
        description: { identifier: "ride" },
        components: {
          "minecraft:emitter_local_space": { position: true, rotation: true },
          "minecraft:emitter_lifetime_expression": { activation_expression: 1 },
          "minecraft:emitter_rate_steady": { spawn_rate: 60, max_particles: 1 },
          "minecraft:particle_lifetime_expression": { max_lifetime: 10 },
        },
      },
    });
    const system = new ParticleSystem();
    const anchor = new THREE.Object3D();
    anchor.position.set(1, 0, 0);
    system.spawn(def, anchor);
    system.update(1 / 30);
    const pos = (system.root.children[0] as THREE.Mesh).geometry.getAttribute("iPos") as THREE.BufferAttribute;
    expect(pos.getX(0)).toBeCloseTo(1);
    anchor.position.set(5, 2, 0);
    system.update(1 / 30);
    expect(pos.getX(0)).toBeCloseTo(5);
    expect(pos.getY(0)).toBeCloseTo(2);
  });

  it("drops spawns past the pool capacity instead of growing", () => {
    const system = new ParticleSystem(undefined, 4);
    system.spawn(parseParticleDefinition(burstDefinition()), new THREE.Object3D());
    system.update(1 / 60);
    expect(system.particleCount).toBe(4);
  });
});
