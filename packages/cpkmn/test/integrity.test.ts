import { describe, expect, it } from "vitest";
import { CpkmnError, pack, unpack, verify } from "../src";
import { ASSET_PACK, GENERATOR, encode, rebuild, syntheticAssets, syntheticPokemon, text } from "./helpers";

async function packed() {
  return pack(syntheticPokemon({ assets: syntheticAssets() }), { assetMode: "embedded", generator: GENERATOR });
}

async function expectError(promise: Promise<unknown>, code: CpkmnError["code"], member?: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CpkmnError);
  expect((error as CpkmnError).code).toBe(code);
  if (member) expect((error as CpkmnError).member).toBe(member);
  return error as CpkmnError;
}

describe("integrity", () => {
  it("catches a tampered member whose hash no longer matches", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        const stats = JSON.parse(text(files["stats.json"]));
        stats.level = 15; // same length as 14, so only the sha256 differs
        files["stats.json"] = encode(stats);
      },
    });
    const error = await expectError(unpack(tampered), "hash_mismatch", "stats.json");
    expect(error.message).toMatch(/sha256/);
    await expectError(verify(tampered), "hash_mismatch", "stats.json");
  });

  it("catches a tampered binary asset", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        files["assets/textures/base.png"][8] ^= 0xff;
      },
    });
    await expectError(unpack(tampered), "hash_mismatch", "assets/textures/base.png");
  });

  it("catches a size mismatch even when only length changed", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        files["memories/summary.md"] = new TextEncoder().encode(text(files["memories/summary.md"]) + " ");
      },
    });
    const error = await expectError(unpack(tampered), "hash_mismatch", "memories/summary.md");
    expect(error.message).toMatch(/bytes/);
  });

  it("refuses an entry that is not listed in the manifest", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        files["trade.json"] = encode({ nonce: "0123456789abcdef0123456789abcdef", fromTrainerId: "0192a8f4-0000-7000-8000-000000000001", offeredAt: "2026-11-02T20:11:00Z", expiresAt: "2026-11-09T20:11:00Z" });
      },
    });
    await expectError(unpack(tampered), "unlisted_member", "trade.json");
  });

  it("refuses when a listed member is missing from the archive", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        delete files["inventory.json"];
      },
    });
    await expectError(unpack(tampered), "missing_member", "inventory.json");
  });

  it("refuses an archive without the mimetype entry", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        delete files["mimetype"];
      },
    });
    await expectError(unpack(tampered), "not_cpkmn");
  });

  it("refuses an archive whose mimetype says something else", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, {
      mutate: (files) => {
        files["mimetype"] = new TextEncoder().encode("application/epub+zip");
      },
    });
    await expectError(unpack(tampered), "not_cpkmn");
  });

  it("refuses bytes that are not a zip", async () => {
    await expectError(unpack(new TextEncoder().encode("hello, not a zip")), "bad_zip");
    await expectError(unpack(new Uint8Array(0)), "bad_zip");
  });

  it("refuses a manifest that is not JSON", async () => {
    const bytes = await packed();
    const tampered = rebuild(bytes, { mutate: () => {} });
    const { unzipSync, zipSync } = await import("fflate");
    const files = unzipSync(tampered);
    files["manifest.json"] = new TextEncoder().encode("{ not json");
    const broken = zipSync({ mimetype: [files["mimetype"], { level: 0 }], ...Object.fromEntries(Object.entries(files).filter(([n]) => n !== "mimetype")) });
    await expectError(unpack(broken), "bad_manifest");
  });

  it("refuses a higher major version with a clear message", async () => {
    const bytes = await packed();
    const future = rebuild(bytes, {
      mutate: (_files, manifest) => {
        manifest.formatVersion = "2.0.0";
      },
    });
    const error = await expectError(unpack(future), "unsupported_version");
    expect(error.message).toMatch(/cpkmn 2\.0\.0/);
    expect(error.message).toMatch(/update the app/);
    await expectError(verify(future), "unsupported_version");
  });

  it("refuses a higher major before checking the manifest shape", async () => {
    const bytes = await packed();
    const future = rebuild(bytes, {
      mutate: (_files, manifest) => {
        manifest.formatVersion = "3.1.0";
        delete (manifest as Partial<typeof manifest>).contents;
      },
    });
    await expectError(unpack(future), "unsupported_version");
  });

  it("warns on a newer minor and still reads", async () => {
    const bytes = await packed();
    const newer = rebuild(bytes, {
      mutate: (_files, manifest) => {
        manifest.formatVersion = "1.4.0";
      },
    });
    const { warnings, pokemon } = await unpack(newer);
    expect(warnings.some((w) => w.code === "newer_minor")).toBe(true);
    expect(pokemon.identity.species).toBe("pikachu");
  });

  it("rejects entry names that escape the archive", async () => {
    const bytes = await packed();
    const evil = rebuild(bytes, {
      mutate: (files) => {
        files["../escape.json"] = encode({});
      },
      rehash: true,
    });
    await expectError(unpack(evil), "bad_entry_name");
  });

  it("warns and drops a member it does not know rather than throwing", async () => {
    const bytes = await packed();
    const extended = rebuild(bytes, {
      mutate: (files) => {
        files["extras/notes.json"] = encode({ hello: "world" });
      },
      rehash: true,
    });
    const { warnings } = await unpack(extended);
    expect(warnings.find((w) => w.code === "unknown_member")?.member).toBe("extras/notes.json");
  });

  it("warns when an embedded file is missing a required asset", async () => {
    const assets = syntheticAssets();
    delete assets["sounds/cry.ogg"];
    const bytes = await pack(syntheticPokemon({ assets }), { assetMode: "embedded", generator: GENERATOR });
    const { warnings } = await unpack(bytes);
    expect(warnings.find((w) => w.code === "asset_missing")?.message).toMatch(/sounds\/cry\.ogg/);
  });
});

describe("pack input checks", () => {
  it("needs assets in embedded mode", async () => {
    await expectError(pack(syntheticPokemon(), { assetMode: "embedded", generator: GENERATOR }), "bad_input");
  });

  it("needs assetPack in reference mode", async () => {
    await expectError(pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR }), "bad_input");
  });

  it("refuses to write a member that fails the schema", async () => {
    const input = syntheticPokemon();
    input.stats.level = 0;
    const error = await expectError(pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK }), "bad_input", "stats.json");
    expect(error.message).toMatch(/\/level/);
  });

  it("refuses an asset path that escapes assets/", async () => {
    const assets = syntheticAssets();
    assets["../identity.json"] = new Uint8Array([1]);
    await expectError(pack(syntheticPokemon({ assets }), { assetMode: "embedded", generator: GENERATOR }), "bad_entry_name");
  });
});
