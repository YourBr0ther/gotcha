// pnpm assets:extract [--jar path] [--out dir] [--species a,b]
// pnpm assets:check <species> [--out dir]
// pnpm assets:particles [--jar path] [--out dir]
// pnpm exec tsx packages/cobblemon-assets/src/cli.ts survey [--jar path] [--out file]

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCatalog } from "./catalog.js";
import { formatCheck, readManifest } from "./check.js";
import { extractAll } from "./extract.js";
import { JarReader } from "./jar.js";
import { extractParticles } from "./particles.js";
import { formatSurvey, runSurvey } from "./survey.js";

export const DEFAULT_JAR = "assets/cobblemon/cobblemon.jar";
export const DEFAULT_OUT = ".cobblemon-cache";
export const DEFAULT_SURVEY = "packages/cobblemon-assets/MOLANG_SURVEY.md";

interface Args {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else flags[arg.slice(2)] = "true";
      }
    } else positional.push(arg);
  }
  return { command, positional, flags };
}

const USAGE = `usage:
  assets:extract [--jar <path>] [--out <dir>] [--species <a,b,...>]
  assets:check <species> [--out <dir>]
  assets:particles [--jar <path>] [--out <dir>]
  survey [--jar <path>] [--out <file>]`;

export async function main(argv: string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);
  const jarPath = resolve(flags.jar ?? DEFAULT_JAR);
  const outDir = resolve(flags.out ?? DEFAULT_OUT);

  switch (command) {
    case "extract": {
      const started = Date.now();
      const jar = openJar(jarPath);
      try {
        const catalog = buildCatalog(jar);
        console.log(`Cobblemon ${catalog.cobblemonVersion}: ${catalog.species.size} species files, ${catalog.models.size} models, ${catalog.animations.size} animation groups, ${catalog.posers.size} posers`);
        const only = flags.species ? flags.species.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        const result = await extractAll({ jar, catalog, outDir, only, log: (line) => console.error(line) });
        const reasons = new Map<string, number>();
        for (const reason of Object.values(result.skipped)) reasons.set(reason.replace(/:.*$/, ""), (reasons.get(reason.replace(/:.*$/, "")) ?? 0) + 1);
        console.log(`extracted ${result.extracted.length} species to ${outDir} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        console.log(`skipped ${Object.keys(result.skipped).length}${reasons.size ? ": " + [...reasons].map(([r, n]) => `${r} (${n})`).join(", ") : ""}`);
        console.log(`index.json lists ${Object.keys(result.index.species).length} species`);
        // The particle effects the animations fire, as their own folder with
        // its own index, so a built cache can gain them without a re-extract.
        await extractParticles({ jar, catalog, outDir, log: (line) => console.error(line) });
      } finally {
        jar.close();
      }
      return 0;
    }
    case "check": {
      const species = positional[0];
      if (!species) {
        console.error(USAGE);
        return 2;
      }
      console.log(formatCheck(await readManifest(outDir, species.toLowerCase())));
      return 0;
    }
    case "particles": {
      const jar = openJar(jarPath);
      try {
        const catalog = buildCatalog(jar);
        const index = await extractParticles({ jar, catalog, outDir, log: (line) => console.error(line) });
        console.log(`wrote ${Object.keys(index.effects).length} particle effects to ${resolve(outDir, "particles")}`);
      } finally {
        jar.close();
      }
      return 0;
    }
    case "survey": {
      const jar = openJar(jarPath);
      try {
        const catalog = buildCatalog(jar);
        const target = resolve(flags.out ?? DEFAULT_SURVEY);
        await writeFile(target, formatSurvey(runSurvey(jar, catalog.cobblemonVersion)));
        console.log(`wrote ${target}`);
      } finally {
        jar.close();
      }
      return 0;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

function openJar(path: string): JarReader {
  try {
    return JarReader.open(path);
  } catch (error) {
    throw new Error(`cannot open Cobblemon jar at ${path}: ${(error as Error).message}. Drop the mod jar there or pass --jar.`);
  }
}

if (process.argv[1] && /[\\/]cli\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
