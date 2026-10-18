/**
 * Scoring rules, shared by the browser (which scores frames live) and the API
 * (which recomputes the point total before storing it).
 *
 * The formula is deliberately a pure function of the tier counts and the best
 * combo, so the server can derive the authoritative point total from a small
 * summary instead of trusting a number the page sends.
 */

/** How often a live attempt is scored, in frames per second of video. */
export const SCORE_SAMPLE_RATE_HZ = 10;

/** How often a reference recording samples the dancer's pose. */
export const REFERENCE_SAMPLE_RATE_HZ = 15;

/**
 * How far either side of the player's position a reference frame may sit and
 * still be matched. Absorbs the reaction lag of both dancers.
 */
export const MATCH_WINDOW_MS = 300;

export const TIERS = ["PERFECT", "GREAT", "GOOD", "OK", "MISS"] as const;

export type Tier = (typeof TIERS)[number];

export type TierCounts = Record<Tier, number>;

/** Lower bound of per-frame similarity (0..1) required for each tier. */
export const TIER_THRESHOLDS: ReadonlyArray<{ tier: Tier; min: number }> = [
  { tier: "PERFECT", min: 0.88 },
  { tier: "GREAT", min: 0.75 },
  { tier: "GOOD", min: 0.6 },
  { tier: "OK", min: 0.4 },
  { tier: "MISS", min: 0 },
];

export const TIER_POINTS: Record<Tier, number> = {
  PERFECT: 100,
  GREAT: 70,
  GOOD: 45,
  OK: 20,
  MISS: 0,
};

/** Points awarded per frame of the longest unbroken non-miss streak. */
export const COMBO_BONUS_PER_FRAME = 10;

/** A frame at or above this tier keeps a combo alive. */
export const COMBO_MIN_TIER: Tier = "GOOD";

export function emptyTierCounts(): TierCounts {
  return { PERFECT: 0, GREAT: 0, GOOD: 0, OK: 0, MISS: 0 };
}

/** Maps a per-frame similarity in 0..1 onto a tier. */
export function tierForSimilarity(similarity: number): Tier {
  for (const { tier, min } of TIER_THRESHOLDS) {
    if (similarity >= min) return tier;
  }
  return "MISS";
}

/** True when a frame of this tier should extend the current combo. */
export function tierKeepsCombo(tier: Tier): boolean {
  return TIER_POINTS[tier] >= TIER_POINTS[COMBO_MIN_TIER];
}

export function totalFrames(counts: TierCounts): number {
  return TIERS.reduce((sum, tier) => sum + counts[tier], 0);
}

/**
 * The authoritative point total for a run.
 *
 * Both sides compute this from the same inputs, so the score shown on the
 * results screen is the score stored against the account.
 */
export function computePoints(counts: TierCounts, maxCombo: number): number {
  const base = TIERS.reduce(
    (sum, tier) => sum + counts[tier] * TIER_POINTS[tier],
    0
  );
  return base + Math.max(0, Math.trunc(maxCombo)) * COMBO_BONUS_PER_FRAME;
}

export const GRADES = ["S", "A", "B", "C", "D"] as const;

export type Grade = (typeof GRADES)[number];

const GRADE_THRESHOLDS: ReadonlyArray<{ grade: Grade; min: number }> = [
  { grade: "S", min: 0.9 },
  { grade: "A", min: 0.8 },
  { grade: "B", min: 0.7 },
  { grade: "C", min: 0.55 },
  { grade: "D", min: 0 },
];

/** Letter grade for a run's mean accuracy (0..1). */
export function gradeForAccuracy(accuracy: number): Grade {
  for (const { grade, min } of GRADE_THRESHOLDS) {
    if (accuracy >= min) return grade;
  }
  return "D";
}

/**
 * The highest point total reachable for a run of `frames` frames: every frame
 * perfect and the combo never broken. Used to show progress as a percentage.
 */
export function maxPointsForFrames(frames: number): number {
  const counts = emptyTierCounts();
  counts.PERFECT = Math.max(0, Math.trunc(frames));
  return computePoints(counts, counts.PERFECT);
}
