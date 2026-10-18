import { randomUUID } from "node:crypto";
import type {
  PlaySessionSummary,
  ProgressResponse,
  ReferenceTrack,
  ReferenceTrackSummary,
  SongBest,
  SubmitRunResponse,
  UserTotals,
} from "../../src/shared/apiTypes.ts";
import type { NewReferenceTrack, NewRun, Store, UserRecord } from "./store.ts";

const RECENT_LIMIT = 10;

function emptyTotals(): UserTotals {
  return { totalPoints: 0, totalPlays: 0, bestPoints: 0, bestAccuracy: 0 };
}

function summarize(track: ReferenceTrack): ReferenceTrackSummary {
  return {
    videoId: track.videoId,
    title: track.title,
    frameCount: track.frames.length,
    durationMs: track.durationMs,
    updatedAt: track.updatedAt,
  };
}

/**
 * Process-local store. Everything is lost on restart; it exists so the game is
 * playable end to end before the Tiger Data service is provisioned.
 */
export class MemoryStore implements Store {
  readonly kind = "memory";

  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();
  private readonly tracks = new Map<string, ReferenceTrack>();
  private readonly runs: Array<{ userId: string; session: PlaySessionSummary }> = [];
  private readonly totals = new Map<string, UserTotals>();

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.email === input.email) return null;
    }
    const user: UserRecord = { id: randomUUID(), createdAt: new Date(), ...input };
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async findSessionUser(tokenHash: string): Promise<UserRecord | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return this.users.get(session.userId) ?? null;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async listReferenceTracks(): Promise<ReferenceTrackSummary[]> {
    return [...this.tracks.values()].map(summarize);
  }

  async getReferenceTrack(videoId: string): Promise<ReferenceTrack | null> {
    return this.tracks.get(videoId) ?? null;
  }

  async hasReferenceTrack(videoId: string): Promise<boolean> {
    return this.tracks.has(videoId);
  }

  async saveReferenceTrack(input: NewReferenceTrack): Promise<ReferenceTrackSummary> {
    const track: ReferenceTrack = {
      videoId: input.videoId,
      playlistId: input.playlistId,
      title: input.title,
      sampleRateHz: input.sampleRateHz,
      durationMs: input.durationMs,
      frames: input.frames,
      updatedAt: new Date().toISOString(),
    };
    this.tracks.set(track.videoId, track);
    return summarize(track);
  }

  async recordRun(run: NewRun): Promise<SubmitRunResponse> {
    const { userId, ...fields } = run;
    const session: PlaySessionSummary = {
      id: randomUUID(),
      playedAt: new Date().toISOString(),
      ...fields,
    };
    this.runs.push({ session, userId });

    const previous = this.totals.get(userId) ?? emptyTotals();
    const totals: UserTotals = {
      totalPoints: previous.totalPoints + run.points,
      totalPlays: previous.totalPlays + 1,
      bestPoints: Math.max(previous.bestPoints, run.points),
      bestAccuracy: Math.max(previous.bestAccuracy, run.accuracy),
    };
    this.totals.set(userId, totals);
    return { session, totals };
  }

  async getProgress(userId: string): Promise<ProgressResponse> {
    const mine = this.runs
      .filter((run) => run.userId === userId)
      .map((run) => run.session);
    const bySong = new Map<string, SongBest>();
    for (const run of mine) {
      const best = bySong.get(run.videoId);
      if (!best) {
        bySong.set(run.videoId, {
          videoId: run.videoId,
          title: run.title,
          bestPoints: run.points,
          bestAccuracy: run.accuracy,
          plays: 1,
          lastPlayedAt: run.playedAt,
        });
        continue;
      }
      best.bestPoints = Math.max(best.bestPoints, run.points);
      best.bestAccuracy = Math.max(best.bestAccuracy, run.accuracy);
      best.plays += 1;
      best.lastPlayedAt = run.playedAt;
      best.title = run.title ?? best.title;
    }

    const recent = mine.slice(-RECENT_LIMIT).reverse();

    return {
      totals: this.totals.get(userId) ?? emptyTotals(),
      songs: [...bySong.values()].sort((a, b) =>
        b.lastPlayedAt.localeCompare(a.lastPlayedAt)
      ),
      recent,
    };
  }

  async close() {}
}
