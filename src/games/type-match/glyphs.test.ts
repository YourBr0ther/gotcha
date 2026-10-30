import { describe, expect, it } from "vitest";
import { TYPE_ROWS } from "./TypeIcon";
import { TYPES } from "./rules";

describe("type glyphs", () => {
  it("draws every type on a 12x12 grid with only known characters", () => {
    for (const type of TYPES) {
      const rows = TYPE_ROWS[type];
      expect(rows, type).toHaveLength(12);
      for (const row of rows) {
        expect(row, `${type}: "${row}"`).toHaveLength(12);
        expect(row, `${type}: "${row}"`).toMatch(/^[.#w]+$/);
      }
      expect(rows.join("")).toContain("w");
    }
  });
});
