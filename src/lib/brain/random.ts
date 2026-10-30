/**
 * A small seeded generator so rules-only choices are the same on every
 * install for the same promptSeed and the same moment. mulberry32, same as
 * the diorama builder.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, for mixing a seed with a moment or a name. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

/** Picks `count` distinct items, order stable per seed. */
export function pickMany<T>(rand: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.floor(rand() * pool.length) % pool.length;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
