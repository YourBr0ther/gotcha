/**
 * Cobblemon species ids to PokeAPI species names.
 *
 * Cobblemon strips every hyphen (`mrmime`, `hooh`, `nidoranf`), PokeAPI keeps
 * them. Everything else matches already, so the table is the hyphenated half
 * of PokeAPI's species list; a Cobblemon id not in it is passed through as is.
 * Regenerate by diffing `pokemon-species?limit=2000` against
 * `.cobblemon-cache/index.json` when either side changes.
 */
export const POKEAPI_NAMES: Readonly<Record<string, string>> = {
  nidoranf: "nidoran-f",
  nidoranm: "nidoran-m",
  mrmime: "mr-mime",
  hooh: "ho-oh",
  mimejr: "mime-jr",
  porygonz: "porygon-z",
  typenull: "type-null",
  jangmoo: "jangmo-o",
  hakamoo: "hakamo-o",
  kommoo: "kommo-o",
  tapukoko: "tapu-koko",
  tapulele: "tapu-lele",
  tapubulu: "tapu-bulu",
  tapufini: "tapu-fini",
  mrrime: "mr-rime",
  greattusk: "great-tusk",
  screamtail: "scream-tail",
  brutebonnet: "brute-bonnet",
  fluttermane: "flutter-mane",
  slitherwing: "slither-wing",
  sandyshocks: "sandy-shocks",
  irontreads: "iron-treads",
  ironbundle: "iron-bundle",
  ironhands: "iron-hands",
  ironjugulis: "iron-jugulis",
  ironmoth: "iron-moth",
  ironthorns: "iron-thorns",
  wochien: "wo-chien",
  chienpao: "chien-pao",
  tinglu: "ting-lu",
  chiyu: "chi-yu",
  roaringmoon: "roaring-moon",
  ironvaliant: "iron-valiant",
  walkingwake: "walking-wake",
  ironleaves: "iron-leaves",
  gougingfire: "gouging-fire",
  ragingbolt: "raging-bolt",
  ironboulder: "iron-boulder",
  ironcrown: "iron-crown",
};

/** PokeAPI species name for a Cobblemon species id. */
export function toPokeApiName(cobblemonId: string): string {
  const id = cobblemonId.toLowerCase();
  return POKEAPI_NAMES[id] ?? id;
}

/** Cobblemon species id for a PokeAPI species name (the inverse of `toPokeApiName`). */
export function toCobblemonId(pokeApiName: string): string {
  return pokeApiName.toLowerCase().replace(/-/g, "");
}
