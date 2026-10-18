import { z } from "zod";
import { SEGMENT_COUNT, SEGMENT_VECTOR_LENGTH } from "../../src/shared/poseSegments.ts";
import { isKnownPlaylistId, isValidVideoId } from "../../src/shared/playlists.ts";
import {
  REFERENCE_SAMPLE_RATE_HZ,
  SCORE_SAMPLE_RATE_HZ,
  TIERS,
  TIER_THRESHOLDS,
  totalFrames,
  type TierCounts,
} from "../../src/shared/scoring.ts";

/** Longest routine accepted, comfortably above any Just Dance track. */
export const MAX_DURATION_MS = 15 * 60 * 1000;

/** Sampling jitter allowance when bounding frame counts by duration. */
const FRAME_SLACK = 1.25;

export const videoIdSchema = z.string().refine(isValidVideoId, "Invalid video id.");

const playlistIdSchema = z
  .string()
  .refine(isKnownPlaylistId, "Unknown playlist.")
  .nullish()
  .transform((value) => value ?? null);

const titleSchema = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((value) => value || null);

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(2).max(40),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const unitFloat = z.number().finite().min(-1.001).max(1.001);
const confidence = z.number().finite().min(0).max(1);

const frameSchema = z.object({
  t: z.number().int().min(0).max(MAX_DURATION_MS),
  v: z.array(unitFloat).length(SEGMENT_VECTOR_LENGTH),
  w: z.array(confidence).length(SEGMENT_COUNT),
});

const MAX_REFERENCE_FRAMES = Math.ceil(
  (MAX_DURATION_MS / 1000) * REFERENCE_SAMPLE_RATE_HZ * FRAME_SLACK
);

export const MIN_REFERENCE_FRAMES = 30;

export const saveReferenceSchema = z
  .object({
    playlistId: playlistIdSchema,
    title: titleSchema,
    sampleRateHz: z.number().positive().max(60),
    durationMs: z.number().int().positive().max(MAX_DURATION_MS),
    frames: z.array(frameSchema).min(MIN_REFERENCE_FRAMES).max(MAX_REFERENCE_FRAMES),
  })
  .superRefine((track, ctx) => {
    for (let i = 1; i < track.frames.length; i++) {
      if (track.frames[i].t <= track.frames[i - 1].t) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", i, "t"],
          message: "Frame timestamps must be strictly increasing.",
        });
        return;
      }
    }
  });

const count = z.number().int().min(0);

const tierCountsSchema = z
  .object(Object.fromEntries(TIERS.map((tier) => [tier, count])) as Record<
    keyof TierCounts,
    typeof count
  >)
  .strict();

export const submitRunSchema = z
  .object({
    videoId: videoIdSchema,
    playlistId: playlistIdSchema,
    title: titleSchema,
    accuracy: z.number().finite().min(0).max(1),
    maxCombo: count,
    tierCounts: tierCountsSchema,
    durationMs: z.number().int().positive().max(MAX_DURATION_MS),
  })
  .superRefine((run, ctx) => {
    const frames = totalFrames(run.tierCounts);
    // Each sample slot of the video can be scored at most once, so a run can
    // never hold more frames than its length allows.
    const ceiling = Math.ceil((run.durationMs / 1000) * SCORE_SAMPLE_RATE_HZ * FRAME_SLACK) + 5;
    if (frames === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tierCounts"], message: "No frames were scored." });
    }
    if (frames > ceiling) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tierCounts"],
        message: "More frames scored than the run's length allows.",
      });
    }
    if (run.maxCombo > frames) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCombo"],
        message: "Combo is longer than the run.",
      });
    }
    if (frames > 0) {
      const [low, high] = accuracyBounds(run.tierCounts);
      if (run.accuracy < low - ACCURACY_EPSILON || run.accuracy > high + ACCURACY_EPSILON) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accuracy"],
          message: "Accuracy does not match the tier breakdown.",
        });
      }
    }
  });

const ACCURACY_EPSILON = 1e-3;

/**
 * The range a run's mean similarity must fall in given its tier counts: every
 * frame sits somewhere between its tier's threshold and the next tier's.
 */
export function accuracyBounds(counts: TierCounts): [number, number] {
  const frames = totalFrames(counts);
  if (frames === 0) return [0, 0];
  let low = 0;
  let high = 0;
  TIER_THRESHOLDS.forEach(({ tier, min }, index) => {
    const ceiling = index === 0 ? 1 : TIER_THRESHOLDS[index - 1].min;
    low += counts[tier] * min;
    high += counts[tier] * ceiling;
  });
  return [low / frames, high / frames];
}
