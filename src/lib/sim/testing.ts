/** Helpers for the sim tests. Not a test file itself. */

import { expect } from "vitest";

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Runs `fn` on a frozen input and checks the input still equals its snapshot. */
export function expectPure<T>(input: T, fn: (input: T) => unknown): void {
  const snapshot = JSON.parse(JSON.stringify(input)) as T;
  fn(deepFreeze(input));
  expect(input).toEqual(snapshot);
}
