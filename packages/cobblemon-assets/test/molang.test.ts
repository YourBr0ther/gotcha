import { describe, expect, it } from "vitest";
import { findAnimationReferences, isMolangExpression, scanMolang, scanOperators } from "../src/molang";

describe("scanMolang", () => {
  it("canonicalises namespaces and keeps the original spelling", () => {
    const refs = scanMolang("math.sin(query.anim_time*90)*v.amp + variable.amp - t.x + c.y");
    expect(refs.map((r) => r.canonical)).toEqual(["math.sin", "q.anim_time", "v.amp", "v.amp", "t.x", "c.y"]);
    expect(refs[1].raw).toBe("query.anim_time");
    expect(refs[0].call).toBe(true);
    expect(refs[1].call).toBe(false);
  });

  it("keeps dotted names like q.r.yaw_change", () => {
    expect(scanMolang("0+q.r.yaw_change(1)*2").map((r) => r.canonical)).toEqual(["q.r.yaw_change"]);
  });

  it("ignores case, as Molang does", () => {
    const [ref] = scanMolang("68+Math.cos(Query.Anim_Time*90)");
    expect(ref.canonical).toBe("math.cos");
    expect(ref.raw).toBe("Math.cos");
    expect(scanMolang("68+Math.cos(Query.Anim_Time*90)")[1].canonical).toBe("q.anim_time");
  });

  it("does not match inside words or paths", () => {
    expect(scanMolang("cobblemon:textures/pokemon/x/t.png front.leg")).toEqual([]);
  });
});

describe("isMolangExpression", () => {
  it("treats bare numbers as static", () => {
    expect(isMolangExpression("0.5")).toBe(false);
    expect(isMolangExpression("-12")).toBe(false);
    expect(isMolangExpression("1e3")).toBe(false);
    expect(isMolangExpression("math.sin(q.anim_time)")).toBe(true);
    expect(isMolangExpression("")).toBe(false);
  });
});

describe("scanOperators", () => {
  it("finds the constructs an interpreter needs", () => {
    const found = scanOperators("q.has_entity ? { q.sound('x'); } : 0; return -v.a * (1 + 2) >= 3 && !q.b");
    for (const name of ["ternary ?:", "logical and &&", "logical not !", "comparison < > <= >=", "statements ;", "return", "braces {}", "string literal '...'"]) {
      expect(found).toContain(name);
    }
  });
});

describe("findAnimationReferences", () => {
  it("reads literal group and clip", () => {
    expect(findAnimationReferences("q.bedrock('eevee', 'ground_idle')")).toEqual([
      { group: "eevee", clips: ["ground_idle"], raw: "q.bedrock('eevee', 'ground_idle')", fn: "bedrock" },
    ]);
  });

  it("reads every name inside q.array and ternaries", () => {
    const [ref] = findAnimationReferences("q.bedrock_quirk('blastoise', q.array('quirk_a', 'quirk_b'), 30, 60, 1)");
    expect(ref.fn).toBe("bedrock_quirk");
    expect(ref.clips).toEqual(["quirk_a", "quirk_b"]);
    const [golem] = findAnimationReferences("q.bedrock('golem', math.random(0, 1) < 0.4 ? 'wild_sleep3' : (math.random(0, 1) < 0.5 ? 'wild_sleep2' : 'wild_sleep1'))");
    expect(golem.clips).toEqual(["wild_sleep3", "wild_sleep2", "wild_sleep1"]);
  });

  it("ignores excluded labels and curves after the clip", () => {
    const [ref] = findAnimationReferences("q.bedrock_primary('larvesta', 'physical', 'look', q.curve('symmetrical_wide'))");
    expect(ref.fn).toBe("bedrock_primary");
    expect(ref.clips).toEqual(["physical"]);
  });

  it("finds several calls in one expression and skips non-bedrock calls", () => {
    const refs = findAnimationReferences("q.look('head') + q.bedrock('a', 'x') + q.bedrock_stateful('b', 'y')");
    expect(refs.map((r) => `${r.group}:${r.clips[0]}`)).toEqual(["a:x", "b:y"]);
  });
});
