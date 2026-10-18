import type { SubmitRunRequest } from "../shared/apiTypes";
import {
  computePoints,
  emptyTierCounts,
  tierForSimilarity,
  tierKeepsCombo,
  type Tier,
  type TierCounts,
} from "../shared/scoring";

export type ScoreSnapshot = {
  points: number;
  combo: number;
  maxCombo: number;
  frames: number;
  /** Mean similarity of the frames scored so far, 0..1. */
  accuracy: number;
  tierCounts: TierCounts;
};

/**
 * Accumulates a run. Each sample slot of the video (see `SCORE_SAMPLE_RATE_HZ`)
 * is scored at most once, so pausing or replaying a section can't farm points.
 */
export class ScoreKeeper {
  private counts = emptyTierCounts();
  private combo = 0;
  private maxCombo = 0;
  private similaritySum = 0;
  private frames = 0;
  private readonly scoredSlots = new Set<number>();

  hasScored(slot: number) {
    return this.scoredSlots.has(slot);
  }

  add(slot: number, similarity: number): Tier {
    this.scoredSlots.add(slot);
    const tier = tierForSimilarity(similarity);
    this.counts[tier] += 1;
    this.frames += 1;
    this.similaritySum += similarity;
    this.combo = tierKeepsCombo(tier) ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    return tier;
  }

  snapshot(): ScoreSnapshot {
    return {
      points: computePoints(this.counts, this.maxCombo),
      combo: this.combo,
      maxCombo: this.maxCombo,
      frames: this.frames,
      accuracy: this.frames ? this.similaritySum / this.frames : 0,
      tierCounts: { ...this.counts },
    };
  }

  toRunRequest(
    meta: Pick<SubmitRunRequest, "videoId" | "playlistId" | "title" | "durationMs">
  ): SubmitRunRequest {
    const snapshot = this.snapshot();
    return {
      ...meta,
      accuracy: snapshot.accuracy,
      maxCombo: snapshot.maxCombo,
      tierCounts: snapshot.tierCounts,
    };
  }
}
