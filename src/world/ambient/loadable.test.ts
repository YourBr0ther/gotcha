import { describe, expect, it } from "vitest";
import { pickAmbient, type AmbientCandidate } from "./candidates";
import { ambientLoadable, pickLoadableAmbient, type AmbientManifest, type AmbientResolver } from "./loadable";

const manifest: AmbientManifest = {
  models: { eevee_male: "models/eevee_male.geo.json", eevee_female: "models/eevee_female.geo.json" },
  animations: { eevee: { file: "animations/eevee.animation.json" } },
  posers: { eevee: { file: "posers/eevee.json" } },
  files: { resolvers: ["resolvers/0_eevee_base.json"] },
};

const base: AmbientResolver = {
  variations: [
    { aspects: [], model: "cobblemon:eevee_male.geo", poser: "cobblemon:eevee", texture: "cobblemon:textures/pokemon/0133_eevee/eevee.png" },
    { aspects: ["shiny"], texture: "cobblemon:textures/pokemon/0133_eevee/eevee_shiny.png" },
  ],
};

describe("ambientLoadable", () => {
  it("accepts a manifest whose base variation names a model, poser and png the manifest carries", () => {
    expect(ambientLoadable(manifest, [base])).toBeNull();
  });

  it("accepts a synthesized poser and a model key that falls back to the first model", () => {
    const synthesized: AmbientManifest = { ...manifest, posers: { flittle: { synthesized: true } }, models: { flittle: "models/flittle.geo.json" } };
    expect(ambientLoadable(synthesized, [base])).toBeNull();
  });

  it("rejects an animated texture, since the loader expects a path", () => {
    const animated: AmbientResolver = {
      variations: [{ aspects: [], model: "cobblemon:golurk.geo", poser: "cobblemon:golurk", texture: { fps: 10, frames: ["a.png", "b.png"] } }],
    };
    expect(ambientLoadable(manifest, [animated])).toBe("animated texture");
  });

  it("rejects a manifest with no base variation, no resolvers, or no animation file", () => {
    expect(ambientLoadable(manifest, [{ variations: [{ aspects: ["shiny"], texture: "x.png" }] }])).toBe("no base variation");
    expect(ambientLoadable(manifest, [])).toBe("no resolvers");
    expect(ambientLoadable({ ...manifest, animations: { eevee: {} } }, [base])).toBe("no animation file");
    expect(ambientLoadable({ ...manifest, animations: {} }, [base])).toBe("no animation file");
    expect(ambientLoadable({ ...manifest, models: {} }, [base])).toBe("no model file");
    expect(ambientLoadable({ ...manifest, posers: {} }, [base])).toBe("no poser");
    expect(ambientLoadable({ ...manifest, posers: { eevee: {} } }, [base])).toBe("poser without a file");
  });
});

const pool: AmbientCandidate[] = [
  { species: "pidgey", baseScale: 0.7, flies: true, swims: false, walks: true },
  { species: "butterfree", baseScale: 0.6, flies: true, swims: false, walks: false },
  { species: "eevee", baseScale: 0.5, flies: false, swims: false, walks: true },
  { species: "rattata", baseScale: 0.4, flies: false, swims: true, walks: true },
  { species: "golurk", baseScale: 1, flies: false, swims: false, walks: true },
];

describe("pickLoadableAmbient", () => {
  it("keeps the plain pick when every species probes fine, probing each once", async () => {
    const probed: string[] = [];
    const picks = await pickLoadableAmbient(pool, "meadow", [], async (s) => {
      probed.push(s);
      return true;
    });
    expect(picks).toEqual(pickAmbient(pool, "meadow"));
    expect(new Set(probed).size).toBe(probed.length);
  });

  it("swaps out a species that fails the probe for the next candidate", async () => {
    const plain = pickAmbient(pool, "cave", ["eevee"]);
    const bad = plain[1].species;
    const probed: string[] = [];
    const picks = await pickLoadableAmbient(pool, "cave", ["eevee"], async (s) => {
      probed.push(s);
      return s !== bad;
    });
    expect(picks).toHaveLength(2);
    expect(picks.map((p) => p.species)).not.toContain(bad);
    expect(picks.map((p) => p.species)).not.toContain("eevee");
    expect(picks).toEqual(pickAmbient(pool, "cave", ["eevee", bad]));
    expect(probed.filter((s) => s === bad)).toHaveLength(1);
  });

  it("returns nothing when no candidate loads", async () => {
    expect(await pickLoadableAmbient(pool, "pond", [], async () => false)).toEqual([]);
  });
});
