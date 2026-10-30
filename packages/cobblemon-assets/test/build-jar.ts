// Builds a synthetic Cobblemon-shaped jar in memory for the tests. Nothing in
// it comes from the real mod.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Zip, ZipDeflate, zipSync } from "fflate";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(fixtures, name)));
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const json = (value: unknown): Uint8Array => text(JSON.stringify(value));

/** A valid 1x1 transparent PNG, for texture entries. */
export const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
const OGG = text("OggS\0\0fake");

export function jarEntries(): Record<string, Uint8Array> {
  const species = (id: string, dex: number, extra: Record<string, unknown> = {}): Uint8Array =>
    json({ ...(JSON.parse(readFileSync(join(fixtures, "cube.species.json"), "utf8")) as object), name: id[0].toUpperCase() + id.slice(1), nationalPokedexNumber: dex, ...extra });
  return {
    "fabric.mod.json": json({ id: "cobblemon", version: "9.9.9+test" }),
    // cube: full JSON poser, gendered model, animated layer, nested texture folder.
    "assets/cobblemon/bedrock/pokemon/models/0001_cube/cube.geo.json": fixture("cube.geo.json"),
    "assets/cobblemon/bedrock/pokemon/models/0001_cube/cube_female.geo.json": fixture("cube_female.geo.json"),
    "assets/cobblemon/bedrock/pokemon/models/0001_cube/license": text("synthetic test license"),
    "assets/cobblemon/bedrock/pokemon/animations/0001_cube/cube.animation.json": fixture("cube.animation.json"),
    "assets/cobblemon/bedrock/pokemon/posers/0001_cube/cube.json": fixture("cube.poser.json"),
    "assets/cobblemon/bedrock/pokemon/resolvers/0001_cube/0_cube_base.json": fixture("cube.resolver.json"),
    "assets/cobblemon/bedrock/pokemon/resolvers/0001_cube/1_cube_female.json": fixture("cube_female.resolver.json"),
    "assets/cobblemon/textures/pokemon/0001_cube/cube.png": PNG,
    "assets/cobblemon/textures/pokemon/0001_cube/cube_shiny.png": PNG,
    "assets/cobblemon/textures/pokemon/0001_cube/cube_alpha.png": PNG,
    "assets/cobblemon/textures/pokemon/0001_cube/cube_unreferenced.png": PNG,
    "assets/cobblemon/textures/pokemon/0001_cube/glow/cube_glow_1.png": PNG,
    "assets/cobblemon/textures/pokemon/0001_cube/glow/cube_glow_2.png": PNG,
    "assets/cobblemon/sounds/pokemon/cube/cube_cry.ogg": OGG,
    "assets/cobblemon/sounds/pokemon/cube/cube_ambient.ogg": OGG,
    "data/cobblemon/species/generation1/cube.json": species("cube", 1),
    "data/cobblemon/dex_entries/pokemon/kanto/cube.json": json({ id: "cobblemon:cube", speciesId: "cobblemon:cube", forms: [] }),
    "data/cobblemon/spawn_pool_world/0001_cube.json": json({ enabled: true, spawns: [{ id: "cube-1", pokemon: "cube", bucket: "common" }] }),
    "data/cobblemon/spawn_pool_world/herds/0001_cube_herd.json": json({ enabled: true, spawns: [{ id: "cube-herd", pokemon: "cube alpha" }] }),
    // block: no JSON poser (Cobblemon would ship it as code), so the poser is synthesized.
    "assets/cobblemon/bedrock/pokemon/models/0002_block/block.geo.json": fixture("cube.geo.json"),
    "assets/cobblemon/bedrock/pokemon/animations/0002_block/block.animation.json": fixture("block.animation.json"),
    "assets/cobblemon/bedrock/pokemon/resolvers/0002_block/0_block_base.json": json({
      order: 0,
      species: "cobblemon:block",
      variations: [{ aspects: [], model: "cobblemon:block.geo", poser: "cobblemon:block", texture: "cobblemon:textures/pokemon/0002_block/block.png" }],
    }),
    "assets/cobblemon/textures/pokemon/0002_block/block.png": PNG,
    "assets/cobblemon/sounds/pokemon/block/block_cry.ogg": OGG,
    "data/cobblemon/species/generation1/block.json": species("block", 2),
    // ghost: marked not implemented.
    "data/cobblemon/species/generation1/ghost.json": species("ghost", 3, { implemented: false }),
    // mute: implemented, resolver, model, but no animation file anywhere.
    "assets/cobblemon/bedrock/pokemon/models/0004_mute/mute.geo.json": fixture("cube.geo.json"),
    "assets/cobblemon/bedrock/pokemon/resolvers/0004_mute/0_mute_base.json": json({
      order: 0,
      species: "cobblemon:mute",
      variations: [{ aspects: [], model: "cobblemon:mute.geo", poser: "cobblemon:mute", texture: "cobblemon:textures/pokemon/0004_mute/mute.png" }],
    }),
    "assets/cobblemon/textures/pokemon/0004_mute/mute.png": PNG,
    "data/cobblemon/species/generation1/mute.json": species("mute", 4),
    // lost: implemented but its model is missing from the jar.
    "assets/cobblemon/bedrock/pokemon/resolvers/0005_lost/0_lost_base.json": json({
      order: 0,
      species: "cobblemon:lost",
      variations: [{ aspects: [], model: "cobblemon:lost.geo", poser: "cobblemon:lost", texture: "cobblemon:textures/pokemon/0005_lost/lost.png" }],
    }),
    "data/cobblemon/species/generation1/lost.json": species("lost", 5),
    "assets/cobblemon/sounds.json": json({
      "pokemon.cube.cry": { sounds: [{ name: "cobblemon:pokemon/cube/cube_cry", volume: 0.8 }] },
      "pokemon.cube.ambient": { sounds: ["cobblemon:pokemon/cube/cube_ambient"] },
      "pokemon.block.cry": { sounds: ["cobblemon:pokemon/block/block_cry"] },
    }),
    "assets/cobblemon/lang/en_us.json": json({
      "cobblemon.species.cube.name": "Cube",
      "cobblemon.species.cube.desc": "A cube. It sits.",
      "cobblemon.species.cube-gmax.desc": "A bigger cube.",
      "cobblemon.species.block.desc": "A block.",
      "item.cobblemon.poke_ball": "Poke Ball",
    }),
    "data/cobblemon/molang/pokemon/test.molang": text("v.x = q.entity_size * 2;\nreturn math.clamp(v.x, 0, 1);"),
    "assets/cobblemon/bedrock/poke_balls/animations/ball.animation.json": json({ animations: { "animation.ball.spin": { bones: { ball: { rotation: [0, "q.life_time*360", 0] } } } } }),
  };
}

/** Jar written in one shot: sizes in the local headers. */
export function buildJar(): Uint8Array {
  return zipSync(jarEntries(), { level: 6 });
}

/** Jar written through fflate's streaming Zip: every entry carries a data descriptor, like the real mod jar. */
export function buildStreamedJar(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    chunks.push(data);
  });
  for (const [name, data] of Object.entries(jarEntries())) {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(data, true);
  }
  zip.end();
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
