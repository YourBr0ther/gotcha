/**
 * Image entry for the Cobblemon extractor. The Dockerfile bundles this to
 * /app/tools/extract.mjs; the entrypoint runs it as
 * `node /app/tools/extract.mjs --jar /data/cobblemon.jar --out /data/cobblemon-cache`.
 *
 * packages/cobblemon-assets/src/cli.ts only runs itself when argv[1] ends in
 * cli.ts, which a bundle never does, so this wrapper calls main() and
 * prepends the subcommand. `particles` as the first argument runs only the
 * particle step (`node /app/tools/extract.mjs particles --jar ... --out ...`),
 * which the entrypoint uses to top up a cache built before that step existed.
 */

import { main } from "../../packages/cobblemon-assets/src/cli";

const args = process.argv.slice(2);
const command = args[0] === "particles" ? args.shift()! : "extract";

main([command, ...args]).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
