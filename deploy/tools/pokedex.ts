/**
 * Image entry for the pokedex builder. The Dockerfile bundles this to
 * /app/tools/pokedex.mjs; the entrypoint runs it in the background as
 * `node /app/tools/pokedex.mjs --cobblemon ... --out ... --cache ...`.
 *
 * Same shape as extract.ts: packages/pokedex/src/cli.ts guards on a cli.ts
 * filename, so the wrapper calls main() with the subcommand in front.
 */

import { main } from "../../packages/pokedex/src/cli";

main(["build", ...process.argv.slice(2)]).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
