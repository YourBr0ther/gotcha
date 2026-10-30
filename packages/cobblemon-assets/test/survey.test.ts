import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { JarReader } from "../src/jar";
import { formatSurvey, runSurvey } from "../src/survey";
import { buildJar } from "./build-jar";

let dir: string;
let jar: JarReader;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cobblemon-survey-"));
  await writeFile(join(dir, "cobblemon.jar"), buildJar());
  jar = JarReader.open(join(dir, "cobblemon.jar"));
});
afterAll(async () => {
  jar.close();
  await rm(dir, { recursive: true, force: true });
});

it("counts query variables, math functions and syntax per category", () => {
  const survey = runSurvey(jar, "9.9.9+test");
  const [animations, posers, scripts, other] = survey.categories;
  expect(animations.files).toBe(2);
  expect(animations.refs.get("q.anim_time")?.count).toBe(2);
  expect(animations.spellings.get("q.anim_time")).toEqual(new Set(["q.anim_time", "query.anim_time"]));
  expect(animations.refs.get("math.sin")?.call).toBe(true);
  expect(animations.refs.get("q.r.yaw_change")?.count).toBe(1);
  expect(animations.refs.has("q.life_time")).toBe(false);
  expect(other.refs.get("q.life_time")?.count).toBe(1);
  expect(posers.refs.get("q.bedrock")?.count).toBeGreaterThan(0);
  expect(posers.refs.get("q.array")?.call).toBe(true);
  expect(scripts.refs.get("v.x")?.count).toBe(2);
  expect(scripts.operators.has("return")).toBe(true);
  expect(scripts.refs.get("v.x")?.example).toBe("v.x = q.entity_size * 2;");
  expect(scripts.refs.get("v.x")?.contexts).toEqual(new Set(["script"]));
  expect(survey.keyframes.clips).toBe(10);
  expect(survey.keyframes.molang).toBe(3);
  expect(survey.keyframes.clipsWithMolang).toBe(2);
  expect(survey.otherStringKeys.has("lerp_mode")).toBe(false);
});

it("renders a markdown report", () => {
  const text = formatSurvey(runSurvey(jar, "9.9.9+test"));
  expect(text).toContain("# Molang survey");
  expect(text).toContain("| `q.anim_time` (also `query.anim_time`) | variable | 2 | 1 | keyframe |");
  expect(text).toContain("## What the renderer's interpreter needs");
  expect(text).toContain("## Pokemon posers");
  expect(text).toContain("| `math.sin` | function | 1 | 1 | keyframe |");
});
