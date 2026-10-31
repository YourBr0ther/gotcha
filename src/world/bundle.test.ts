import { describe, expect, it } from "vitest";
import { assetUrl, pickFromManifest, poserFromEntry, rememberedVersion, rememberVersion, resolveVariation } from "./bundle";

describe("bundle loader", () => {
  const resolvers = [
    {
      variations: [
        { aspects: [], model: "cobblemon:eevee_male.geo", poser: "cobblemon:eevee", texture: "cobblemon:textures/pokemon/0133_eevee/eevee.png" },
        { aspects: ["shiny"], texture: "cobblemon:textures/pokemon/0133_eevee/eevee_shiny.png" },
        { aspects: ["alpha_eyes"], layers: [{ emissive: true, name: "alpha_eyes", texture: "cobblemon:textures/pokemon/0133_eevee/eevee_alpha.png" }] },
      ],
    },
    { variations: [{ aspects: ["female"], model: "cobblemon:eevee_female.geo" }] },
  ];

  it("applies every matching variation in order, later overriding earlier", () => {
    expect(resolveVariation(resolvers, [])).toEqual({ model: "eevee_male", poser: "eevee", texture: "eevee.png" });
    expect(resolveVariation(resolvers, ["shiny", "female"])).toEqual({ model: "eevee_female", poser: "eevee", texture: "eevee_shiny.png" });
  });

  it("picks up an emissive layer for its aspect", () => {
    expect(resolveVariation(resolvers, ["alpha_eyes"]).emissive).toBe("eevee_alpha.png");
    expect(resolveVariation(resolvers, []).emissive).toBeUndefined();
  });

  it("takes the first frame of an animated texture, and every frame of an animated layer (Slugma's lava)", () => {
    const animated = [
      {
        variations: [
          {
            aspects: [],
            model: "cobblemon:slugma.geo",
            poser: "cobblemon:slugma",
            texture: { fps: 10, frames: ["textures/slugma_0.png", "textures/slugma_1.png"], loop: true },
            layers: [{ emissive: true, name: "flame", texture: { fps: 10, frames: ["textures/slugma_flame_0.png", "textures/slugma_flame_1.png"] } }],
          },
        ],
      },
    ];
    expect(resolveVariation(animated, [])).toEqual({
      model: "slugma",
      poser: "slugma",
      texture: "slugma_0.png",
      emissive: "slugma_flame_0.png",
      emissiveFrames: { keys: ["slugma_flame_0.png", "slugma_flame_1.png"], fps: 10 },
    });
  });

  it("versions every asset URL", () => {
    expect(assetUrl("eevee", "textures/eevee.png", "6ec83e50606812f5")).toBe("/api/assets/eevee/textures/eevee.png?v=6ec83e50606812f5");
    expect(assetUrl("eevee", "manifest.json")).toBe("/api/assets/eevee/manifest.json");
  });

  it("uses a synthesized poser inline when the manifest entry has no file", () => {
    const poser = poserFromEntry({
      synthesized: true,
      animations: { cry: "q.bedrock_stateful('flittle', 'cry')" },
      poses: { hovering: { poseTypes: ["HOVER"], animations: ["q.bedrock('flittle', 'air_idle')"] } },
    });
    expect(poser).toEqual({
      animations: { cry: "q.bedrock_stateful('flittle', 'cry')" },
      poses: { hovering: { poseTypes: ["HOVER"], animations: ["q.bedrock('flittle', 'air_idle')"] } },
    });
    expect("synthesized" in poser).toBe(false);
  });
});

describe("pickFromManifest", () => {
  const manifest = {
    models: { eevee_female: "models/eevee_female.geo.json", eevee_male: "models/eevee_male.geo.json" },
    animations: { eevee: { file: "animations/eevee.animation.json" } },
    posers: { eevee: { file: "posers/eevee.json", synthesized: false } },
    files: { species: "species.json" },
    variations: [
      { aspects: [], layers: [], model: "models/eevee_male.geo.json", poser: "posers/eevee.json", texture: "textures/eevee.png" },
      { aspects: ["shiny"], texture: "textures/eevee_shiny.png" },
      { aspects: ["alpha_eyes"], layers: [{ emissive: true, name: "alpha_eyes", texture: "textures/eevee_alpha.png" }] },
      { aspects: ["female"], model: "models/eevee_female.geo.json" },
    ],
  };

  it("maps the manifest's file paths back onto its model and poser keys", () => {
    const picked = pickFromManifest(manifest, "eevee", []);
    expect(picked.model).toBe("models/eevee_male.geo.json");
    expect(picked.poser.file).toBe("posers/eevee.json");
    expect(picked.animations).toBe("animations/eevee.animation.json");
    expect(picked.texture).toBe("textures/eevee.png");
    expect(picked.emissive).toBeUndefined();
  });

  it("applies aspect variations in order, so a shiny female gets the female model and the shiny skin", () => {
    const picked = pickFromManifest(manifest, "eevee", ["female", "shiny", "alpha_eyes"]);
    expect(picked.model).toBe("models/eevee_female.geo.json");
    expect(picked.texture).toBe("textures/eevee_shiny.png");
    expect(picked.emissive).toBe("textures/eevee_alpha.png");
  });

  it("throws when a map is empty rather than asking the route for undefined", () => {
    expect(() => pickFromManifest({ ...manifest, models: {} }, "eevee", [])).toThrow(/missing model/);
  });
});

describe("remembered versions", () => {
  it("survives a missing localStorage", () => {
    expect(rememberedVersion("eevee")).toBeUndefined();
    expect(() => rememberVersion("eevee", "abc")).not.toThrow();
  });
});
