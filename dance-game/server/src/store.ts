/**
 * Persistence boundary for the API.
 *
 * Two implementations: `PgStore` talks to Postgres (Tiger Data in production)
 * and `MemoryStore` keeps everything in process so the game runs before a
 * database exists. Route handlers only ever see this interface.
 */

import type {
  ProgressResponse,
  ReferenceTrack,
  ReferenceTrackSummary,
  SubmitRunResponse,
} from "../../src/shared/apiTypes.ts";
import type { Grade, TierCounts } from "../../src/shared/scoring.ts";

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
};

export type NewReferenceTrack = Omit<ReferenceTrack, "updatedAt"> & {
  recordedBy: string;
};

/** A validated run with its server-computed point total and grade. */
export type NewRun = {
  userId: string;
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
};

export interface Store {
  readonly kind: "memory" | "postgres";

  /** Resolves `null` when the email is already registered. */
  createUser(user: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;

  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** The user owning an unexpired session, or `null`. */
  findSessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  listReferenceTracks(): Promise<ReferenceTrackSummary[]>;
  getReferenceTrack(videoId: string): Promise<ReferenceTrack | null>;
  hasReferenceTrack(videoId: string): Promise<boolean>;
  saveReferenceTrack(track: NewReferenceTrack): Promise<ReferenceTrackSummary>;

  /** Stores the run and folds it into the user's cumulative totals atomically. */
  recordRun(run: NewRun): Promise<SubmitRunResponse>;
  getProgress(userId: string): Promise<ProgressResponse>;

  close(): Promise<void>;
}
