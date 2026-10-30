import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPokeApiClient, type FetchLike, type PokeApiClient } from "../src/pokeapi";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const POKEAPI_FIXTURES = join(FIXTURES, "pokeapi");
export const COBBLEMON_FIXTURES = join(FIXTURES, "cobblemon");

/** A fetch that fails the test if anything reaches the network. */
export const noNetwork: FetchLike = async (url) => {
  throw new Error(`test tried to fetch ${url}`);
};

/** A client that only answers from the recorded fixtures. */
export function fixtureClient(): PokeApiClient {
  return createPokeApiClient({ cacheDir: POKEAPI_FIXTURES, fetch: noNetwork });
}
