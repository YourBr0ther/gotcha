import { expect, it } from "vitest";
import { parseArgs } from "../src/cli";

it("parses subcommand, positionals and flags in both spellings", () => {
  expect(parseArgs(["check", "eevee", "--out", "cache"])).toEqual({ command: "check", positional: ["eevee"], flags: { out: "cache" } });
  expect(parseArgs(["extract", "--species=eevee,pikachu", "--jar", "x.jar"])).toEqual({ command: "extract", positional: [], flags: { species: "eevee,pikachu", jar: "x.jar" } });
  expect(parseArgs(["extract", "--verbose"])).toEqual({ command: "extract", positional: [], flags: { verbose: "true" } });
  expect(parseArgs([])).toEqual({ command: undefined, positional: [], flags: {} });
});
