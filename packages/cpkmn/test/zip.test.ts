import { describe, expect, it } from "vitest";
import { pack, unpack, MIMETYPE } from "../src";
import { ASSET_PACK, EXPORTED_AT, GENERATOR, readCentralDirectory, rebuild, syntheticAssets, syntheticPokemon, syntheticTrade } from "./helpers";

const STORED = 0;
const DEFLATE = 8;

describe("container layout", () => {
  it("mimetype first and stored, manifest.json second, assets stored, everything else deflated", async () => {
    const input = syntheticPokemon({ assets: syntheticAssets(), trade: syntheticTrade() });
    const bytes = await pack(input, { assetMode: "embedded", generator: GENERATOR, now: EXPORTED_AT });
    const dir = readCentralDirectory(bytes);

    expect(dir.map((e) => e.name)).toEqual([
      "mimetype",
      "manifest.json",
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
      "trade.json",
      "assets/animations.animation.json",
      "assets/model.geo.json",
      "assets/poser.json",
      "assets/sounds.json",
      "assets/sounds/cry.ogg",
      "assets/textures/base.png",
      "assets/textures/shiny.png",
    ]);

    for (const entry of dir) {
      const expected = entry.name === "mimetype" || entry.name.startsWith("assets/") ? STORED : DEFLATE;
      expect(entry.method, entry.name).toBe(expected);
    }
    expect(dir[0].localHeaderOffset).toBe(0);
    expect(dir[0].compressedSize).toBe(MIMETYPE.length);
  });

  it("starts with the ZIP local header and the media type, so the first 38 bytes are the magic", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe("mimetype");
    expect(new TextDecoder().decode(bytes.subarray(38, 38 + MIMETYPE.length))).toBe(MIMETYPE);
  });

  it("warns, but still reads, when entries are out of order or compressed the wrong way", async () => {
    const bytes = await pack(syntheticPokemon({ assets: syntheticAssets() }), { assetMode: "embedded", generator: GENERATOR });
    const names = readCentralDirectory(bytes).map((e) => e.name);
    const shuffled = rebuild(bytes, {
      mutate: () => {},
      order: [...names.filter((n) => n !== "mimetype"), "mimetype"],
      stored: () => false,
    });
    const { warnings, pokemon } = await unpack(shuffled);
    expect(pokemon.identity.species).toBe("pikachu");
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("entry_order");
    expect(codes).toContain("compression");
  });
});
