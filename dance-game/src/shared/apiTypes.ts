/**
 * Request and response shapes for the game API.
 *
 * Imported by both the browser client and the server, so a change to a payload
 * breaks the build on whichever side has not caught up. Timestamps cross the
 * wire as ISO 8601 strings.
 */

import type { Grade, TierCounts } from "./scoring";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

/** One sampled pose from a recorded routine. */
export type ReferenceFrame = {
  /** Milliseconds into the YouTube video. */
  t: number;
  /**
   * Flattened segment unit vectors, `SEGMENT_VECTOR_LENGTH` floats long:
   * `[x0, y0, x1, y1, ...]` in `POSE_SEGMENTS` order.
   */
  v: number[];
  /** Per-segment confidence in 0..1, `SEGMENT_COUNT` long. */
  w: number[];
};

export type ReferenceTrack = {
  videoId: string;
  playlistId: string | null;
  title: string | null;
  sampleRateHz: number;
  durationMs: number;
  frames: ReferenceFrame[];
  updatedAt: string;
};

/** Listing entry: enough to badge a track as having a routine, without frames. */
export type ReferenceTrackSummary = {
  videoId: string;
  title: string | null;
  frameCount: number;
  durationMs: number;
  updatedAt: string;
};

export type SaveReferenceTrackRequest = {
  playlistId?: string | null;
  title?: string | null;
  sampleRateHz: number;
  durationMs: number;
  frames: ReferenceFrame[];
};

export type PlaySessionSummary = {
  id: string;
  videoId: string;
  playlistId: string | null;
  title: string | null;
  points: number;
  accuracy: number;
  grade: Grade;
  maxCombo: number;
  scoredFrames: number;
  tierCounts: TierCounts;
  durationMs: number;
  playedAt: string;
};

export type SubmitRunRequest = {
  videoId: string;
  playlistId?: string | null;
  title?: string | null;
  /** Mean per-frame similarity in 0..1. Stored for display. */
  accuracy: number;
  maxCombo: number;
  tierCounts: TierCounts;
  durationMs: number;
};

/** Cumulative totals held against the account. */
export type UserTotals = {
  totalPoints: number;
  totalPlays: number;
  bestPoints: number;
  bestAccuracy: number;
};

export type SongBest = {
  videoId: string;
  title: string | null;
  bestPoints: number;
  bestAccuracy: number;
  plays: number;
  lastPlayedAt: string;
};

export type SubmitRunResponse = {
  session: PlaySessionSummary;
  totals: UserTotals;
};

export type ProgressResponse = {
  totals: UserTotals;
  songs: SongBest[];
  recent: PlaySessionSummary[];
};

export type VideoMeta = {
  videoId: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string;
};

export type PlaylistMeta = {
  id: string;
  name: string;
  blurb: string;
  accent: string;
  symbol: string;
};

export type SignupRequest = {
  email: string;
  displayName: string;
  password: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
