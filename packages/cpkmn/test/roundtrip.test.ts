import { describe, expect, it } from "vitest";
import { createSigner, generatePrivateKey, pack, unpack, FORMAT_VERSION, MIMETYPE } from "../src";
import { ASSET_PACK, EXPORTED_AT, GENERATOR, POKEMON_ID, readManifest, syntheticAssets, syntheticPokemon, syntheticTrade } from "./helpers";

describe("round trip", () => {
  it("embedded: pack then unpack deep-equals the input", async () => {
    const input = syntheticPokemon({ assets: syntheticAssets() });
    const bytes = await pack(input, { assetMode: "embedded", generator: GENERATOR, now: EXPORTED_AT });
    const { pokemon, manifest, verification, warnings } = await unpack(bytes);

    expect(pokemon).toEqual(input);
    expect(pokemon.extra).toBeUndefined();
    expect(verification).toBe("unsigned");
    expect(warnings.map((w) => w.code)).toEqual(["unsigned"]);
    expect(manifest.format).toBe("cpkmn");
    expect(manifest.formatVersion).toBe(FORMAT_VERSION);
    expect(manifest.assetMode).toBe("embedded");
    expect(manifest.pokemonId).toBe(POKEMON_ID);
    expect(manifest.exportedAt).toBe(EXPORTED_AT);
    expect(manifest.createdAt).toBe(input.identity.hatchedAt);
    expect(manifest.generator).toEqual(GENERATOR);
    expect(Object.keys(manifest.contents).sort()).toEqual(
      [
        "identity.json",
        "stats.json",
        "state.json",
        "personality.json",
        "memories/summary.md",
        "memories/episodic.jsonl",
        "memories/relationships.json",
        "pokedex.json",
        "inventory.json",
        "history.json",
        ...Object.keys(syntheticAssets()).map((p) => `assets/${p}`),
      ].sort(),
    );
  });

  it("reference: pack then unpack deep-equals the input and carries no assets", async () => {
    const input = syntheticPokemon();
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, now: EXPORTED_AT, assetPack: ASSET_PACK });
    const { pokemon, manifest } = await unpack(bytes);

    expect(pokemon).toEqual(input);
    expect(pokemon.assets).toBeUndefined();
    expect(manifest.assetMode).toBe("reference");
    expect(manifest.assetPack).toEqual(ASSET_PACK);
    expect(Object.keys(manifest.contents).some((n) => n.startsWith("assets/"))).toBe(false);
    expect(bytes.length).toBeLessThan(200 * 1024);
  });

  it("reference mode ignores assets handed to it", async () => {
    const input = syntheticPokemon({ assets: syntheticAssets() });
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { pokemon } = await unpack(bytes);
    expect(pokemon.assets).toBeUndefined();
  });

  it("carries trade.json when present", async () => {
    const input = syntheticPokemon({ trade: syntheticTrade() });
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { pokemon, manifest } = await unpack(bytes);
    expect(pokemon.trade).toEqual(syntheticTrade());
    expect(manifest.contents["trade.json"]).toBeDefined();
  });

  it("signed round trip with a known key is verified and still deep-equals", async () => {
    const privateKey = generatePrivateKey();
    const signer = createSigner(privateKey, "test.local#2026-10");
    const { publicKeyFromPrivate } = await import("../src");
    const knownKeys = { "test.local#2026-10": await publicKeyFromPrivate(privateKey) };

    const input = syntheticPokemon({ assets: syntheticAssets() });
    const bytes = await pack(input, { assetMode: "embedded", generator: GENERATOR, signer, now: EXPORTED_AT });
    const { pokemon, verification, warnings } = await unpack(bytes, { knownKeys });
    expect(verification).toBe("verified");
    expect(warnings).toEqual([]);
    expect(pokemon).toEqual(input);
  });

  it("packing is deterministic for the same input and clock", async () => {
    const input = syntheticPokemon({ assets: syntheticAssets() });
    const a = await pack(input, { assetMode: "embedded", generator: GENERATOR, now: EXPORTED_AT });
    const b = await pack(input, { assetMode: "embedded", generator: GENERATOR, now: EXPORTED_AT });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("does not touch state.lastTickAt (stasis is the importer's job)", async () => {
    const input = syntheticPokemon();
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { pokemon } = await unpack(bytes);
    expect(pokemon.state.lastTickAt).toBe(input.state.lastTickAt);
  });

  it("writes memories as markdown text and JSONL, one event per line", async () => {
    const input = syntheticPokemon();
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { unzipSync } = await import("fflate");
    const files = unzipSync(bytes);
    const decode = (name: string) => new TextDecoder().decode(files[name]);
    expect(decode("memories/summary.md")).toBe(input.memories.summary);
    const lines = decode("memories/episodic.jsonl").split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1).map((l) => JSON.parse(l))).toEqual(input.memories.episodic);
    expect(decode("mimetype")).toBe(MIMETYPE);
  });

  it("round-trips an empty episodic log and empty relationships", async () => {
    const input = syntheticPokemon();
    input.memories = { summary: "", episodic: [], relationships: {} };
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { pokemon } = await unpack(bytes);
    expect(pokemon.memories).toEqual(input.memories);
  });

  it("reads the manifest back in the same shape pack wrote it", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK, now: EXPORTED_AT });
    const onDisk = readManifest(bytes);
    const { manifest } = await unpack(bytes);
    expect(manifest).toEqual(onDisk);
  });
});

describe("unknown keys", () => {
  it("survive the round trip in pokemon.extra and are written back", async () => {
    const input = syntheticPokemon({
      extra: {
        identity: { ribbon: "contest_star" },
        state: { mood: "sunny" },
        history: { futureField: { nested: [1, 2, 3] } },
        manifest: { exporterNote: "from a newer install" },
      },
    });
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });

    const onDisk = readManifest(bytes);
    expect((onDisk as unknown as Record<string, unknown>).exporterNote).toBe("from a newer install");

    const { pokemon, warnings } = await unpack(bytes);
    expect(pokemon.extra).toEqual(input.extra);
    expect(pokemon.identity).toEqual(input.identity);
    expect(pokemon).toEqual(input);
    expect(warnings.filter((w) => w.code === "unknown_keys").map((w) => w.member).sort()).toEqual(
      ["history.json", "identity.json", "state.json"],
    );

    const again = await pack(pokemon, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const second = await unpack(again);
    expect(second.pokemon).toEqual(input);
  });

  it("nested unknown keys pass through untouched", async () => {
    const input = syntheticPokemon();
    (input.stats.evolution as Record<string, unknown>).newNestedThing = true;
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { pokemon } = await unpack(bytes);
    expect(pokemon.stats.evolution).toEqual(input.stats.evolution);
  });

  it("extras never override a known field", async () => {
    const input = syntheticPokemon({ extra: { identity: { species: "mewtwo" } } });
    const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const { pokemon } = await unpack(bytes);
    expect(pokemon.identity.species).toBe("pikachu");
    expect(pokemon.extra).toBeUndefined();
  });
});
