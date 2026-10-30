import { describe, expect, it } from "vitest";
import { POKEAPI_NAMES, toCobblemonId, toPokeApiName } from "../src/names";

describe("Cobblemon id to PokeAPI name", () => {
  it("maps the ids whose PokeAPI name carries a hyphen", () => {
    expect(toPokeApiName("mrmime")).toBe("mr-mime");
    expect(toPokeApiName("hooh")).toBe("ho-oh");
    expect(toPokeApiName("nidoranf")).toBe("nidoran-f");
    expect(toPokeApiName("nidoranm")).toBe("nidoran-m");
    expect(toPokeApiName("mimejr")).toBe("mime-jr");
    expect(toPokeApiName("porygonz")).toBe("porygon-z");
    expect(toPokeApiName("typenull")).toBe("type-null");
    expect(toPokeApiName("jangmoo")).toBe("jangmo-o");
    expect(toPokeApiName("hakamoo")).toBe("hakamo-o");
    expect(toPokeApiName("kommoo")).toBe("kommo-o");
    expect(toPokeApiName("tapukoko")).toBe("tapu-koko");
    expect(toPokeApiName("mrrime")).toBe("mr-rime");
    expect(toPokeApiName("ironleaves")).toBe("iron-leaves");
    expect(toPokeApiName("walkingwake")).toBe("walking-wake");
  });

  it("passes through ids PokeAPI already spells the same way", () => {
    for (const id of ["eevee", "farfetchd", "sirfetchd", "flabebe", "magikarp", "pikachu", "zubat"]) expect(toPokeApiName(id)).toBe(id);
  });

  it("is case-insensitive", () => {
    expect(toPokeApiName("MrMime")).toBe("mr-mime");
    expect(toPokeApiName("Eevee")).toBe("eevee");
  });

  it("round-trips every entry through toCobblemonId", () => {
    for (const [id, name] of Object.entries(POKEAPI_NAMES)) {
      expect(name).toContain("-");
      expect(toCobblemonId(name)).toBe(id);
      expect(id).not.toContain("-");
    }
  });
});
