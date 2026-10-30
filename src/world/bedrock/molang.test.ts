import { describe, expect, it } from "vitest";
import { evaluateMolang, isTimeDependent, MolangUnsupported } from "./molang";

const ctx = { animTime: 0.5, lifeTime: 12 };

describe("molang", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evaluateMolang("1 + 2 * 3", ctx)).toBe(7);
    expect(evaluateMolang("(1 + 2) * 3", ctx)).toBe(9);
    expect(evaluateMolang("-4 / 2 - 1", ctx)).toBe(-3);
    expect(evaluateMolang("2.5f * 2", ctx)).toBe(5);
  });

  it("reads anim_time and life_time under both prefixes", () => {
    expect(evaluateMolang("q.anim_time", ctx)).toBe(0.5);
    expect(evaluateMolang("query.anim_time * 2", ctx)).toBe(1);
    expect(evaluateMolang("q.life_time", ctx)).toBe(12);
    expect(evaluateMolang("Query.Life_Time", ctx)).toBe(12);
  });

  it("takes degrees for sin and cos", () => {
    expect(evaluateMolang("math.sin(90)", ctx)).toBeCloseTo(1);
    expect(evaluateMolang("math.cos(180)", ctx)).toBeCloseTo(-1);
    expect(evaluateMolang("math.sin(q.anim_time * 360) * 4", ctx)).toBeCloseTo(0);
    expect(evaluateMolang("math.sin(q.anim_time * 180) * 4", ctx)).toBeCloseTo(4);
  });

  it("has abs, clamp and lerp", () => {
    expect(evaluateMolang("math.abs(-3)", ctx)).toBe(3);
    expect(evaluateMolang("math.clamp(7, 0, 5)", ctx)).toBe(5);
    expect(evaluateMolang("math.clamp(-7, 0, 5)", ctx)).toBe(0);
    expect(evaluateMolang("math.lerp(10, 20, 0.25)", ctx)).toBe(12.5);
  });

  it("supports comparisons and the ternary", () => {
    expect(evaluateMolang("q.anim_time > 0.25 ? 1 : 2", ctx)).toBe(1);
    expect(evaluateMolang("q.anim_time > 0.75 ? 1 : 2", ctx)).toBe(2);
    expect(evaluateMolang("!(1 == 1) || 0", ctx)).toBe(0);
    expect(evaluateMolang("1 && 2", ctx)).toBe(1);
  });

  it("accepts the statement form", () => {
    expect(evaluateMolang("return q.anim_time * 2;", ctx)).toBe(1);
  });

  it("reads variables from the context", () => {
    expect(evaluateMolang("variable.speed * 2", { ...ctx, vars: { speed: 3 } })).toBe(6);
    expect(evaluateMolang("v.speed", { ...ctx, vars: { speed: 3 } })).toBe(3);
  });

  it("throws MolangUnsupported for things outside the subset", () => {
    expect(() => evaluateMolang("q.is_on_ground", ctx)).toThrow(MolangUnsupported);
    expect(() => evaluateMolang("math.die_roll(1, 2, 3)", ctx)).toThrow(MolangUnsupported);
    expect(() => evaluateMolang("variable.nope", ctx)).toThrow(MolangUnsupported);
    expect(() => evaluateMolang("1 +", ctx)).toThrow(MolangUnsupported);
    expect(() => evaluateMolang("1 @ 2", ctx)).toThrow(MolangUnsupported);
  });

  it("reads ride queries as zero and math.random as the midpoint", () => {
    expect(evaluateMolang("0+q.r.yaw_change(1)*2", ctx)).toBe(0);
    expect(evaluateMolang("q.r.velocity_y(0)*-1", ctx)).toBe(-0);
    expect(evaluateMolang("0-(math.random(-0.1,0.1))", ctx)).toBe(0);
    expect(evaluateMolang("Math.Cos(0)", ctx)).toBe(1);
  });

  it("divides by zero to zero like Molang", () => {
    expect(evaluateMolang("1 / 0", ctx)).toBe(0);
  });

  it("knows which expressions change over time", () => {
    expect(isTimeDependent("math.sin(45) * 2")).toBe(false);
    expect(isTimeDependent("math.sin(q.anim_time * 90)")).toBe(true);
    expect(isTimeDependent("variable.x")).toBe(true);
  });
});
