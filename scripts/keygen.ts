/**
 * Prints a fresh ed25519 keypair for signing .cpkmn exports.
 *
 *   pnpm tsx scripts/keygen.ts [keyId]
 *
 * The private key goes in the CPKMN_SIGNING_KEY env var (the
 * gotcha-secrets secret on the cluster) together with
 * CPKMN_KEY_ID. The public key block is what the install serves at
 * /.well-known/cpkmn-keys.json; other installs paste it into their known
 * keys. Default keyId is gotcha#YYYY-MM; the spec's convention is
 * host#YYYY-MM so a rotated key gets a new id.
 */
import { generatePrivateKey, publicKeyFromPrivate, type KeyFile } from "@gotcha/cpkmn";

async function main() {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const keyId = process.argv[2] ?? `gotcha#${stamp}`;

  const privateKey = generatePrivateKey();
  const publicKey = await publicKeyFromPrivate(privateKey);
  const keyFile: KeyFile = { keys: [{ keyId, alg: "ed25519", publicKey }] };

  console.log("# secret (never commit)");
  console.log(`CPKMN_SIGNING_KEY=${privateKey}`);
  console.log(`CPKMN_KEY_ID=${keyId}`);
  console.log();
  console.log("# public, serve at /.well-known/cpkmn-keys.json");
  console.log(JSON.stringify(keyFile, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
