import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JarReader } from "../src/jar";
import { buildJar, buildStreamedJar, jarEntries, PNG } from "./build-jar";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cobblemon-jar-"));
  await writeFile(join(dir, "plain.jar"), buildJar());
  await writeFile(join(dir, "streamed.jar"), buildStreamedJar());
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe.each(["plain.jar", "streamed.jar"])("JarReader on %s", (file) => {
  it("lists every entry and inflates text, JSON and binary", () => {
    const jar = JarReader.open(join(dir, file));
    try {
      expect(jar.entries.size).toBe(Object.keys(jarEntries()).length);
      expect(jar.readJson<{ version: string }>("fabric.mod.json").version).toBe("9.9.9+test");
      expect(jar.read("assets/cobblemon/textures/pokemon/0001_cube/cube.png")).toEqual(PNG);
      expect(jar.readText("assets/cobblemon/bedrock/pokemon/models/0001_cube/license")).toBe("synthetic test license");
      expect(jar.names("data/cobblemon/species/")).toHaveLength(5);
      expect(jar.has("nope")).toBe(false);
      expect(() => jar.read("nope")).toThrow(/not found/);
    } finally {
      jar.close();
    }
  });
});

it("rejects a file that is not a zip", async () => {
  await writeFile(join(dir, "junk.jar"), "not a jar at all");
  expect(() => JarReader.open(join(dir, "junk.jar"))).toThrow(/not a zip/);
});
