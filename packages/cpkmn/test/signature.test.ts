import { describe, expect, it } from "vitest";
import {
  canonical,
  createSigner,
  generatePrivateKey,
  knownKeysFromKeyFile,
  pack,
  publicKeyFromPrivate,
  signaturePayload,
  unpack,
  verify,
} from "../src";
import { ASSET_PACK, EXPORTED_AT, GENERATOR, readManifest, rebuild, syntheticPokemon } from "./helpers";

const KEY_ID = "pocket.test#2026-10";

async function keypair() {
  const privateKey = generatePrivateKey();
  const publicKey = await publicKeyFromPrivate(privateKey);
  return { signer: createSigner(privateKey, KEY_ID), knownKeys: { [KEY_ID]: publicKey }, publicKey };
}

async function signedFile(signer: ReturnType<typeof createSigner>) {
  return pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK, signer, now: EXPORTED_AT });
}

describe("signatures", () => {
  it("a good signature with a known key is verified", async () => {
    const { signer, knownKeys } = await keypair();
    const bytes = await signedFile(signer);
    const manifest = readManifest(bytes);
    expect(manifest.signature).toMatchObject({ alg: "ed25519", keyId: KEY_ID, signedAt: EXPORTED_AT });

    const result = await verify(bytes, knownKeys);
    expect(result.verification).toBe("verified");
    expect(result.keyId).toBe(KEY_ID);
    expect(result.reason).toBeUndefined();

    const unpacked = await unpack(bytes, { knownKeys });
    expect(unpacked.verification).toBe("verified");
    expect(unpacked.warnings.some((w) => w.code === "unsigned" || w.code === "signature_invalid")).toBe(false);
  });

  it("no signature gives unsigned", async () => {
    const { knownKeys } = await keypair();
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    expect(readManifest(bytes).signature).toBeUndefined();
    expect((await verify(bytes, knownKeys)).verification).toBe("unsigned");
    const unpacked = await unpack(bytes, { knownKeys });
    expect(unpacked.verification).toBe("unsigned");
    expect(unpacked.warnings.map((w) => w.code)).toContain("unsigned");
  });

  it("an unknown key gives unverified with a reason", async () => {
    const { signer } = await keypair();
    const bytes = await signedFile(signer);
    const result = await verify(bytes, {});
    expect(result.verification).toBe("unverified");
    expect(result.reason).toMatch(/unknown key/);
    const unpacked = await unpack(bytes);
    expect(unpacked.verification).toBe("unverified");
    expect(unpacked.warnings.find((w) => w.code === "signature_invalid")?.message).toMatch(KEY_ID);
  });

  it("a signature by a different key gives unverified", async () => {
    const { signer } = await keypair();
    const other = await keypair();
    const bytes = await signedFile(signer);
    const result = await verify(bytes, other.knownKeys);
    expect(result.verification).toBe("unverified");
    expect(result.reason).toMatch(/does not match/);
  });

  it("a signature over different content gives unverified", async () => {
    const { signer, knownKeys } = await keypair();
    const bytes = await signedFile(signer);
    // Rewrite a member and its hash so the hashes pass but the signed contents differ.
    const retouched = rebuild(bytes, {
      mutate: (files) => {
        const inventory = JSON.parse(new TextDecoder().decode(files["inventory.json"]));
        inventory.heldItem = "master_ball";
        files["inventory.json"] = new TextEncoder().encode(JSON.stringify(inventory, null, 2) + "\n");
      },
      rehash: true,
    });
    const result = await verify(retouched, knownKeys);
    expect(result.verification).toBe("unverified");
    const unpacked = await unpack(retouched, { knownKeys });
    expect(unpacked.verification).toBe("unverified");
    expect(unpacked.pokemon.inventory.heldItem).toBe("master_ball");
  });

  it("a corrupted signature value gives unverified rather than throwing", async () => {
    const { signer, knownKeys } = await keypair();
    const bytes = await signedFile(signer);
    const corrupted = rebuild(bytes, {
      mutate: (_files, manifest) => {
        manifest.signature!.value = "not base64!!";
      },
    });
    const result = await verify(corrupted, knownKeys);
    expect(result.verification).toBe("unverified");
  });

  it("signs the RFC 8785 canonical JSON of exactly the four fields", async () => {
    const { signer, publicKey } = await keypair();
    const bytes = await signedFile(signer);
    const manifest = readManifest(bytes);
    const expected = canonical({
      contents: manifest.contents,
      exportedAt: manifest.exportedAt,
      pokemonId: manifest.pokemonId,
      assetMode: manifest.assetMode,
    });
    expect(new TextDecoder().decode(signaturePayload(manifest))).toBe(expected);
    expect(expected.startsWith('{"assetMode":"reference","contents":{')).toBe(true);

    const { verifyAsync } = await import("@noble/ed25519");
    const sig = Uint8Array.from(Buffer.from(manifest.signature!.value, "base64"));
    const pub = Uint8Array.from(Buffer.from(publicKey, "base64"));
    expect(await verifyAsync(sig, new TextEncoder().encode(expected), pub)).toBe(true);
  });

  it("canonical() sorts keys, drops whitespace, and formats numbers the ES way", () => {
    expect(canonical({ b: 1, a: [1.0, 1e21, "x"], c: { z: null, y: true } })).toBe('{"a":[1,1e+21,"x"],"b":1,"c":{"y":true,"z":null}}');
    expect(() => canonical(undefined)).toThrow();
  });

  it("createSigner rejects a key of the wrong size and an empty keyId", () => {
    expect(() => createSigner(Buffer.alloc(16).toString("base64"), KEY_ID)).toThrow(/32 bytes/);
    expect(() => createSigner(generatePrivateKey(), "")).toThrow(/keyId/);
  });

  it("knownKeysFromKeyFile reads the well-known shape", async () => {
    const { publicKey } = await keypair();
    expect(knownKeysFromKeyFile({ keys: [{ keyId: KEY_ID, alg: "ed25519", publicKey }] })).toEqual({ [KEY_ID]: publicKey });
  });
});
