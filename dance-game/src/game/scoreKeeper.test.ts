import { describe, expect, it } from "vitest";
import { computePoints } from "../shared/scoring";
import { ScoreKeeper } from "./scoreKeeper";

describe("ScoreKeeper", () => {
  it("tracks tiers, combos and accuracy", () => {
    const keeper = new ScoreKeeper();
    keeper.add(0, 0.95);
    keeper.add(1, 0.8);
    keeper.add(2, 0.1);
    keeper.add(3, 0.9);
    const snapshot = keeper.snapshot();
    expect(snapshot.tierCounts).toMatchObject({ PERFECT: 2, GREAT: 1, MISS: 1 });
    expect(snapshot.maxCombo).toBe(2);
    expect(snapshot.combo).toBe(1);
    expect(snapshot.accuracy).toBeCloseTo((0.95 + 0.8 + 0.1 + 0.9) / 4);
    expect(snapshot.points).toBe(computePoints(snapshot.tierCounts, 2));
  });

  it("remembers which slots were scored", () => {
    const keeper = new ScoreKeeper();
    keeper.add(7, 1);
    expect(keeper.hasScored(7)).toBe(true);
    expect(keeper.hasScored(8)).toBe(false);
  });
});
