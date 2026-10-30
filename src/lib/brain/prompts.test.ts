import { describe, expect, it } from "vitest";
import { LINE_MAX_CHARS } from "./constants";
import { BLOCK_ORDER, clipLine, rollupPrompt, talkPrompt, tickPrompt } from "./prompts";
import { fakeContext, MIDNIGHT } from "./test/helpers";

function tagPositions(text: string, tags: readonly string[]): number[] {
  return tags.map((t) => text.indexOf(`<${t}>`));
}

describe("prompts", () => {
  it("the tick prompt carries every block, each once, in the fixed order", () => {
    const text = tickPrompt(fakeContext());
    const positions = tagPositions(text, BLOCK_ORDER);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const tag of BLOCK_ORDER) {
      expect(text.match(new RegExp(`<${tag}>`, "g"))).toHaveLength(1);
      expect(text.match(new RegExp(`</${tag}>`, "g"))).toHaveLength(1);
    }
  });

  it("the state block is the engine's numbers and the menu is what the engine allowed", () => {
    const ctx = fakeContext({ needs: { hunger: 17 } });
    const text = tickPrompt(ctx);
    expect(text).toContain("hunger: 17 (low");
    expect(text).toContain(`mood: ${ctx.mood.label}`);
    expect(text).toContain(`activities (pick exactly one): ${ctx.menu.activities.join(", ")}`);
    expect(text).toContain(`emotes (pick one or none): ${ctx.menu.emotes.join(", ")}`);
    expect(text).toContain("Eevee (eevee)");
    expect(text).toContain("avoids water");
    expect(text).toContain("short vee-vee cries");
    expect(text).toContain("Eli fed Vee");
  });

  it("the talk prompt keeps the order and adds what the trainer said before the schema", () => {
    const text = talkPrompt(fakeContext(), "who's a good Eevee?");
    const positions = tagPositions(text, [...BLOCK_ORDER.slice(0, -1), "trainer_said", "output_schema"]);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain(`Eli says to you: "who's a good Eevee?"`);
  });

  it("the roll-up prompt names the day and lists the events", () => {
    const ctx = fakeContext({ now: MIDNIGHT, summary: "I like Eli." });
    const text = rollupPrompt({ ...ctx, dayEvents: ctx.recentEvents, day: "2026-11-02" });
    expect(text.indexOf("<memory_summary>")).toBeLessThan(text.indexOf("<day_events>"));
    expect(text).toContain("date: 2026-11-02");
    expect(text).toContain("I like Eli.");
  });

  it("clips a line to the limit at a word boundary and drops an empty one", () => {
    const long = "vee ".repeat(60);
    const clipped = clipLine(long)!;
    expect(clipped.length).toBeLessThanOrEqual(LINE_MAX_CHARS);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipLine("  Vee!  ")).toBe("Vee!");
    expect(clipLine("   ")).toBeUndefined();
    expect(clipLine(null)).toBeUndefined();
  });
});
