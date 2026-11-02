import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { makeTrainer } from "./testing";
import { cleanDisplayName, setDisplayName } from "./trainers";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("trainers");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("display names", () => {
  it("cleans a name: normalised, no control or direction characters, one space between words, 24 at most", () => {
    expect(cleanDisplayName("  Chris   V ")).toBe("Chris V");
    expect(cleanDisplayName("Ma\u202Eddie\u0007")).toBe("Maddie");
    expect(cleanDisplayName("\uFF2D\uFF41\uFF44")).toBe("Mad");
    expect(cleanDisplayName("x".repeat(40))).toHaveLength(24);
    expect(cleanDisplayName(" \u200B ")).toBe("");
  });

  it("sets a cleaned name and refuses one someone else in the family already goes by, or another login", async () => {
    const chris = await makeTrainer(t.db, "chris", "chris");
    const maddie = await makeTrainer(t.db, "maddie", "Maddie");
    expect((await setDisplayName(t.db, chris.id, "  Chris ")).displayName).toBe("Chris");
    await expect(setDisplayName(t.db, chris.id, "maddie")).rejects.toMatchObject({ code: "name_taken" });
    await expect(setDisplayName(t.db, chris.id, "MADDIE")).rejects.toMatchObject({ code: "name_taken" });
    await expect(setDisplayName(t.db, maddie.id, "")).rejects.toMatchObject({ code: "bad_request" });
    // Keeping your own name, or a new spelling of it, is fine.
    expect((await setDisplayName(t.db, maddie.id, "Maddie")).displayName).toBe("Maddie");
  });
});
