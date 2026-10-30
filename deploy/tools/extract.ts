/**
 * Image entry for the Cobblemon extractor. The Dockerfile bundles this to
 * /app/tools/extract.mjs; the entrypoint runs it as
 * `node /app/tools/extract.mjs --jar /data/cobblemon.jar --out /data/cobblemon-cache`.
 *
 * packages/cobblemon-assets/src/cli.ts only runs itself when argv[1] ends in
 * cli.ts, which a bundle never does, so this wrapper calls main() and
 * prepends the subcommand.
 */

import { main } from "../../packages/cobblemon-assets/src/cli";

main(["extract", ...process.argv.slice(2)]).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
