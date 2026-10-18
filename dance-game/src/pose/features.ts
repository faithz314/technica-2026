/**
 * Turns MediaPipe landmarks into the compact per-segment form that reference
 * tracks store, and scores one pose against another.
 */

import type { ReferenceFrame, ReferenceTrack } from "../shared/apiTypes";
import { POSE_SEGMENTS, SEGMENT_COUNT } from "../shared/poseSegments";
import { MATCH_WINDOW_MS } from "../shared/scoring";

/** The subset of MediaPipe's `NormalizedLandmark` this module reads. */
export type Landmark = { x: number; y: number; visibility?: number };

/** One pose: segment unit vectors and their confidences. */
export type PoseFeatures = Pick<ReferenceFrame, "v" | "w">;

/** Angular error forgiven outright: webcam pose estimates jitter this much. */
const TOLERANCE_RAD = (15 * Math.PI) / 180;
/** Beyond the tolerance, similarity falls linearly to 0 over this span. */
const FALLOFF_RAD = (60 * Math.PI) / 180;
/** Reference segments below this confidence are left out of the comparison. */
const MIN_REFERENCE_CONFIDENCE = 0.5;
/** Player confidence ramps a segment's credit from 0 to full across this range. */
const PLAYER_CONFIDENCE_LOW = 0.3;
const PLAYER_CONFIDENCE_HIGH = 0.7;
/**
 * A reference frame where less than this share of the body (by weight) was
 * visible says too little about the move to score against.
 */
const MIN_REFERENCE_COVERAGE = 0.35;

const TOTAL_WEIGHT = POSE_SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function average(landmarks: Landmark[], indices: readonly number[], aspect: number) {
  let x = 0;
  let y = 0;
  let confidence = 1;
  for (const index of indices) {
    const landmark = landmarks[index];
    x += landmark.x * aspect;
    y += landmark.y;
    confidence = Math.min(confidence, landmark.visibility ?? 0);
  }
  return { x: x / indices.length, y: y / indices.length, confidence };
}

/**
 * Reduces a pose to unit vectors, one per segment.
 *
 * MediaPipe normalizes x by frame width and y by frame height, so `aspect`
 * (width / height) rescales x back into the same units as y; otherwise a
 * 16:9 camera would read every diagonal limb at the wrong angle.
 */
export function extractFeatures(landmarks: Landmark[], aspect: number): PoseFeatures {
  const v: number[] = [];
  const w: number[] = [];
  for (const segment of POSE_SEGMENTS) {
    const from = average(landmarks, segment.from, aspect);
    const to = average(landmarks, segment.to, aspect);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      v.push(0, 0);
      w.push(0);
      continue;
    }
    v.push(dx / length, dy / length);
    w.push(Math.min(from.confidence, to.confidence));
  }
  return { v, w };
}

export type PoseMatch = {
  /** Weighted similarity in 0..1. */
  score: number;
  /** Per-segment similarity, `null` where the reference didn't count it. */
  segments: (number | null)[];
};

/**
 * How closely `player` matches `reference`, or `null` when the reference
 * frame doesn't show enough of the body to judge.
 *
 * Segments the reference can't see are skipped; segments the player hides
 * (stepping out of frame, say) earn nothing, so dodging the camera can't help.
 */
export function comparePoses(player: PoseFeatures | null, reference: PoseFeatures): PoseMatch | null {
  const segments: (number | null)[] = new Array(SEGMENT_COUNT).fill(null);
  let weighted = 0;
  let weightSum = 0;

  POSE_SEGMENTS.forEach((segment, i) => {
    if (reference.w[i] < MIN_REFERENCE_CONFIDENCE) return;

    let similarity = 0;
    if (player) {
      const dot =
        player.v[2 * i] * reference.v[2 * i] + player.v[2 * i + 1] * reference.v[2 * i + 1];
      const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
      const credit = clamp01(
        (player.w[i] - PLAYER_CONFIDENCE_LOW) / (PLAYER_CONFIDENCE_HIGH - PLAYER_CONFIDENCE_LOW)
      );
      similarity = credit * clamp01(1 - (angle - TOLERANCE_RAD) / FALLOFF_RAD);
    }

    segments[i] = similarity;
    weighted += similarity * segment.weight;
    weightSum += segment.weight;
  });

  if (weightSum < TOTAL_WEIGHT * MIN_REFERENCE_COVERAGE) return null;
  return { score: weighted / weightSum, segments };
}

/** Index of the first frame at or after `t`. */
function lowerBound(frames: ReferenceFrame[], t: number) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (frames[mid].t < t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Best match for the player's pose among reference frames within
 * `MATCH_WINDOW_MS` of `tMs`, so a dancer a beat early or late isn't punished.
 * `null` when there's no usable reference there (a gap in the recording, or
 * the reference dancer was out of shot).
 */
export function matchAt(
  track: Pick<ReferenceTrack, "frames">,
  tMs: number,
  player: PoseFeatures | null
): PoseMatch | null {
  const { frames } = track;
  let best: PoseMatch | null = null;
  for (let i = lowerBound(frames, tMs - MATCH_WINDOW_MS); i < frames.length; i++) {
    if (frames[i].t > tMs + MATCH_WINDOW_MS) break;
    const match = comparePoses(player, frames[i]);
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best;
}

/** Rounds a frame for upload: three decimals is far below estimator noise. */
export function compactFrame(t: number, features: PoseFeatures): ReferenceFrame {
  return {
    t: Math.round(t),
    v: features.v.map((value) => Math.round(value * 1000) / 1000),
    w: features.w.map((value) => Math.round(value * 100) / 100),
  };
}
