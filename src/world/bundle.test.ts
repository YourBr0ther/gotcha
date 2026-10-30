import { describe, expect, it } from "vitest";
import { assetUrl, poserFromEntry, resolveVariation } from "./bundle";

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
