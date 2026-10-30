/**
 * One negative test per member: the schema rejects it standalone, and unpack
 * refuses an archive carrying it (with hashes recomputed so only the schema
 * stands in the way).
 */
import { describe, expect, it } from "vitest";
import { CpkmnError, pack, unpack, validateMember, type SchemaDef } from "../src";
import { ASSET_PACK, GENERATOR, encode, readManifest, rebuild, syntheticPokemon, syntheticTrade, text } from "./helpers";

interface Case {
  def: SchemaDef;
  member: string;
  break: (value: Record<string, unknown>) => void;
  path: RegExp;
}

const CASES: Case[] = [
  { def: "identity", member: "identity.json", break: (v) => (v.species = "Pikachu!"), path: /\/species/ },
  { def: "identity", member: "identity.json", break: (v) => delete v.originalTrainer, path: /originalTrainer/ },
  { def: "stats", member: "stats.json", break: (v) => (v.level = 101), path: /\/level/ },
  { def: "stats", member: "stats.json", break: (v) => ((v.ivs as Record<string, unknown>).luck = 3), path: /\/ivs/ },
  { def: "state", member: "state.json", break: (v) => (v.status = ["asleep"]), path: /\/status\/0/ },
  { def: "state", member: "state.json", break: (v) => (v.lastTickAt = "yesterday"), path: /\/lastTickAt/ },
  { def: "personality", member: "personality.json", break: (v) => (v.traits = []), path: /\/traits/ },
  { def: "personality", member: "personality.json", break: (v) => (v.promptSeed = -1), path: /\/promptSeed/ },
  { def: "relationships", member: "memories/relationships.json", break: (v) => (v["0192a8f4-0000-7000-8000-000000000001"] = { bond: 101 }), path: /\/bond/ },
  { def: "pokedex", member: "pokedex.json", break: (v) => (v.types = ["electric", "fire", "water"]), path: /\/types/ },
  { def: "inventory", member: "inventory.json", break: (v) => (v.heldItem = 42), path: /\/heldItem/ },
  { def: "history", member: "history.json", break: (v) => (v.imports = [{ at: "2026-11-02T20:11:00Z", install: "x", verification: "maybe" }]), path: /\/imports\/0\/verification/ },
  { def: "trade", member: "trade.json", break: (v) => (v.nonce = "short"), path: /\/nonce/ },
];

describe("schema negatives", () => {
  for (const c of CASES) {
    it(`${c.def}: ${c.break.toString().replace(/^\(v\) => /, "")}`, async () => {
      const input = syntheticPokemon({ trade: syntheticTrade() });
      const bytes = await pack(input, { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
      const broken = rebuild(bytes, {
        mutate: (files) => {
          const value = JSON.parse(text(files[c.member])) as Record<string, unknown>;
          c.break(value);
          expect(validateMember(c.def, value).map((f) => f.path).join(" ")).toMatch(c.path);
          files[c.member] = encode(value);
        },
        rehash: true,
      });
      const error = await unpack(broken).then(
        () => undefined,
        (e: unknown) => e as CpkmnError,
      );
      expect(error).toBeInstanceOf(CpkmnError);
      expect(error!.code).toBe("schema");
      expect(error!.member).toBe(c.member);
      expect(error!.message).toMatch(c.path);
    });
  }

  it("episodicEvent: a bad line is dropped with a warning, not a throw", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const broken = rebuild(bytes, {
      mutate: (files) => {
        const bad = { ts: "2026-11-01T09:12:00Z", kind: "dream", summary: "unknown kind", importance: 2 };
        expect(validateMember("episodicEvent", bad).map((f) => f.path).join(" ")).toMatch(/\/kind/);
        files["memories/episodic.jsonl"] = new TextEncoder().encode(text(files["memories/episodic.jsonl"]) + JSON.stringify(bad) + "\n");
      },
      rehash: true,
    });
    const { pokemon, warnings } = await unpack(broken);
    expect(pokemon.memories.episodic).toHaveLength(3);
    const dropped = warnings.find((w) => w.code === "episodic_line_dropped");
    expect(dropped?.path).toBe("line 4");
  });

  it("episodicEvent: a line that is not JSON is corruption", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const broken = rebuild(bytes, {
      mutate: (files) => {
        files["memories/episodic.jsonl"] = new TextEncoder().encode("{\"ts\":\n");
      },
      rehash: true,
    });
    await expect(unpack(broken)).rejects.toMatchObject({ code: "bad_member", member: "memories/episodic.jsonl" });
  });

  it("manifest: a bad contents hash shape is refused", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    expect(validateMember("manifest", readManifest(bytes))).toEqual([]);
    const broken = rebuild(bytes, {
      mutate: (_files, manifest) => {
        manifest.contents["identity.json"].sha256 = "NOT-HEX";
      },
    });
    await expect(unpack(broken)).rejects.toMatchObject({ code: "bad_manifest" });
  });

  it("manifest: reference mode without assetPack is refused", async () => {
    const bytes = await pack(syntheticPokemon(), { assetMode: "reference", generator: GENERATOR, assetPack: ASSET_PACK });
    const broken = rebuild(bytes, {
      mutate: (_files, manifest) => {
        delete manifest.assetPack;
      },
    });
    const error = await unpack(broken).then(() => undefined, (e: unknown) => e as CpkmnError);
    expect(error?.code).toBe("bad_manifest");
    expect(error?.message).toMatch(/assetPack/);
  });

  it("manifest: contents may not list mimetype or manifest.json", () => {
    const bytes = { sha256: "a".repeat(64), bytes: 1 };
    const base = { format: "cpkmn", formatVersion: "1.0.0", generator: GENERATOR, pokemonId: "0192a8f4-6c3e-7d8a-b4e1-9f2c1b3a5d7e", createdAt: "2026-10-30T15:04:05Z", exportedAt: "2026-10-30T15:04:05Z", assetMode: "embedded" };
    expect(validateMember("manifest", { ...base, contents: { "identity.json": bytes } })).toEqual([]);
    expect(validateMember("manifest", { ...base, contents: { mimetype: bytes } })).not.toEqual([]);
    expect(validateMember("manifest", { ...base, contents: { "manifest.json": bytes } })).not.toEqual([]);
  });

  it("the synthetic pokemon is valid in every member", () => {
    const p = syntheticPokemon({ trade: syntheticTrade() });
    expect(validateMember("identity", p.identity)).toEqual([]);
    expect(validateMember("stats", p.stats)).toEqual([]);
    expect(validateMember("state", p.state)).toEqual([]);
    expect(validateMember("personality", p.personality)).toEqual([]);
    for (const e of p.memories.episodic) expect(validateMember("episodicEvent", e)).toEqual([]);
    expect(validateMember("relationships", p.memories.relationships)).toEqual([]);
    expect(validateMember("pokedex", p.pokedex)).toEqual([]);
    expect(validateMember("inventory", p.inventory)).toEqual([]);
    expect(validateMember("history", p.history)).toEqual([]);
    expect(validateMember("trade", p.trade)).toEqual([]);
  });
});
