import { beforeEach, describe, expect, it } from "vitest";
import { mulberry32 } from "../dioramas/build";
import type { AmbientPick } from "./candidates";
import { ambientLoadable, type AmbientManifest, type AmbientResolver, chooseVisitor, resetAmbientProbes } from "./loadable";

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

  it("rejects a poser whose resting pose has no clip, and accepts one that has", () => {
    const withPoses = (poses: Record<string, { poseTypes?: string[]; clips?: string[] }>): AmbientManifest => ({ ...manifest, posers: { eevee: { file: "posers/eevee.json", poses } } });
    expect(ambientLoadable(withPoses({ standing: { poseTypes: ["STAND"], clips: ["eevee:ground_idle"] } }), [base])).toBeNull();
    expect(ambientLoadable(withPoses({ cry: { poseTypes: [], clips: ["eevee:cry"] } }), [base])).toBe("no idle pose");
    expect(ambientLoadable(withPoses({ standing: { poseTypes: ["STAND"], clips: [] } }), [base])).toBe("no idle pose");
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

const cast: AmbientPick[] = [
  { species: "pidgey", role: "flier" },
  { species: "butterfree", role: "flier" },
  { species: "eevee", role: "walker" },
  { species: "rattata", role: "walker" },
  { species: "golurk", role: "walker" },
];

describe("chooseVisitor", () => {
  beforeEach(() => resetAmbientProbes());

  it("returns a cast member that probes fine, never an excluded one", async () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 10; i++) {
      const pick = await chooseVisitor(cast, ["eevee", "pidgey"], async () => true, rand);
      expect(pick).not.toBeNull();
      expect(["eevee", "pidgey"]).not.toContain(pick!.species);
    }
  });

  it("skips a species that fails the probe and probes each species once for the page", async () => {
    const probed: string[] = [];
    const probe = async (s: string) => {
      probed.push(s);
      return s !== "golurk";
    };
    const rand = mulberry32(2);
    for (let i = 0; i < 20; i++) {
      const pick = await chooseVisitor(cast, [], probe, rand);
      expect(pick!.species).not.toBe("golurk");
    }
    expect(new Set(probed).size).toBe(probed.length);
  });

  it("falls back to the whole cast when exclusions empty it, and to null when nothing loads", async () => {
    const one: AmbientPick[] = [{ species: "eevee", role: "walker" }];
    expect((await chooseVisitor(one, ["eevee"], async () => true, mulberry32(3)))!.species).toBe("eevee");
    resetAmbientProbes();
    expect(await chooseVisitor(cast, [], async () => false, mulberry32(4))).toBeNull();
  });
});
