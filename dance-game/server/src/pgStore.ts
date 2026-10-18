import { readFileSync } from "node:fs";
import pg from "pg";
import type {
  PlaySessionSummary,
  ProgressResponse,
  ReferenceFrame,
  ReferenceTrack,
  ReferenceTrackSummary,
  SongBest,
  SubmitRunResponse,
  UserTotals,
} from "../../src/shared/apiTypes.ts";
import type { Grade, TierCounts } from "../../src/shared/scoring.ts";
import { SCHEMA_SQL } from "./schema.ts";
import type { NewReferenceTrack, NewRun, Store, UserRecord } from "./store.ts";

const RECENT_LIMIT = 10;
const SONG_LIMIT = 50;

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
};

type SessionRow = {
  id: string;
  video_id: string;
  playlist_id: string | null;
  title: string | null;
  points: number;
  accuracy: number;
  grade: Grade;
  max_combo: number;
  scored_frames: number;
  tier_counts: TierCounts;
  duration_ms: number;
  played_at: Date;
};

type TotalsRow = {
  total_points: string;
  total_plays: number;
  best_points: number;
  best_accuracy: number;
};

const SESSION_COLUMNS = `id, video_id, playlist_id, title, points, accuracy, grade,
  max_combo, scored_frames, tier_counts, duration_ms, played_at`;

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function toSession(row: SessionRow): PlaySessionSummary {
  return {
    id: row.id,
    videoId: row.video_id,
    playlistId: row.playlist_id,
    title: row.title,
    points: row.points,
    accuracy: row.accuracy,
    grade: row.grade,
    maxCombo: row.max_combo,
    scoredFrames: row.scored_frames,
    tierCounts: row.tier_counts,
    durationMs: row.duration_ms,
    playedAt: row.played_at.toISOString(),
  };
}

function toTotals(row: TotalsRow | undefined): UserTotals {
  if (!row) return { totalPoints: 0, totalPlays: 0, bestPoints: 0, bestAccuracy: 0 };
  return {
    // bigint arrives as a string; cumulative points stay far below 2^53.
    totalPoints: Number(row.total_points),
    totalPlays: row.total_plays,
    bestPoints: row.best_points,
    bestAccuracy: row.best_accuracy,
  };
}

/**
 * Tiger Data signs its servers with its own CA (`ca.timescale.com`) rather than
 * a public one, so verification needs that CA pinned. When a CA file is given,
 * `sslmode` is dropped from the URL because pg lets it override `ssl`.
 */
function connectionOptions(connectionString: string, caFile?: string): pg.PoolConfig {
  if (!caFile) return { connectionString };
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { ca: readFileSync(caFile, "utf8"), rejectUnauthorized: true },
  };
}

/** Postgres-backed store. Point `DATABASE_URL` at the Tiger Data service. */
export class PgStore implements Store {
  readonly kind = "postgres";
  private readonly pool: pg.Pool;

  constructor(connectionString: string, caFile?: string) {
    this.pool = new pg.Pool({ ...connectionOptions(connectionString, caFile), max: 10 });
  }

  async migrate() {
    await this.pool.query(SCHEMA_SQL);
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      `insert into users (email, display_name, password_hash)
       values ($1, $2, $3)
       on conflict (email) do nothing
       returning *`,
      [input.email, input.displayName, input.passwordHash]
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      "select * from users where email = $1",
      [email]
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    await this.pool.query(
      "insert into auth_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)",
      [tokenHash, userId, expiresAt]
    );
  }

  async findSessionUser(tokenHash: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      `select u.* from auth_sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [tokenHash]
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async deleteSession(tokenHash: string) {
    await this.pool.query("delete from auth_sessions where token_hash = $1", [tokenHash]);
  }

  async listReferenceTracks(): Promise<ReferenceTrackSummary[]> {
    const { rows } = await this.pool.query<{
      video_id: string;
      title: string | null;
      frame_count: number;
      duration_ms: number;
      updated_at: Date;
    }>(
      `select video_id, title, frame_count, duration_ms, updated_at
       from reference_tracks order by updated_at desc`
    );
    return rows.map((row) => ({
      videoId: row.video_id,
      title: row.title,
      frameCount: row.frame_count,
      durationMs: row.duration_ms,
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async getReferenceTrack(videoId: string): Promise<ReferenceTrack | null> {
    const { rows } = await this.pool.query<{
      video_id: string;
      playlist_id: string | null;
      title: string | null;
      sample_rate_hz: number;
      duration_ms: number;
      frames: ReferenceFrame[];
      updated_at: Date;
    }>(
      `select video_id, playlist_id, title, sample_rate_hz, duration_ms, frames, updated_at
       from reference_tracks where video_id = $1`,
      [videoId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      videoId: row.video_id,
      playlistId: row.playlist_id,
      title: row.title,
      sampleRateHz: row.sample_rate_hz,
      durationMs: row.duration_ms,
      frames: row.frames,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async hasReferenceTrack(videoId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "select 1 from reference_tracks where video_id = $1",
      [videoId]
    );
    return (rowCount ?? 0) > 0;
  }

  async saveReferenceTrack(track: NewReferenceTrack): Promise<ReferenceTrackSummary> {
    const { rows } = await this.pool.query<{ updated_at: Date }>(
      `insert into reference_tracks
         (video_id, playlist_id, title, sample_rate_hz, duration_ms, frame_count, frames, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (video_id) do update set
         playlist_id    = excluded.playlist_id,
         title          = excluded.title,
         sample_rate_hz = excluded.sample_rate_hz,
         duration_ms    = excluded.duration_ms,
         frame_count    = excluded.frame_count,
         frames         = excluded.frames,
         recorded_by    = excluded.recorded_by,
         updated_at     = now()
       returning updated_at`,
      [
        track.videoId,
        track.playlistId,
        track.title,
        track.sampleRateHz,
        track.durationMs,
        track.frames.length,
        JSON.stringify(track.frames),
        track.recordedBy,
      ]
    );
    return {
      videoId: track.videoId,
      title: track.title,
      frameCount: track.frames.length,
      durationMs: track.durationMs,
      updatedAt: rows[0].updated_at.toISOString(),
    };
  }

  async recordRun(run: NewRun): Promise<SubmitRunResponse> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<SessionRow>(
        `insert into play_sessions
           (user_id, video_id, playlist_id, title, points, accuracy, grade,
            max_combo, scored_frames, tier_counts, duration_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning ${SESSION_COLUMNS}`,
        [
          run.userId,
          run.videoId,
          run.playlistId,
          run.title,
          run.points,
          run.accuracy,
          run.grade,
          run.maxCombo,
          run.scoredFrames,
          JSON.stringify(run.tierCounts),
          run.durationMs,
        ]
      );
      const totals = await client.query<TotalsRow>(
        `insert into user_totals (user_id, total_points, total_plays, best_points, best_accuracy)
         values ($1, $2::bigint, 1, $2::integer, $3)
         on conflict (user_id) do update set
           total_points  = user_totals.total_points + excluded.total_points,
           total_plays   = user_totals.total_plays + 1,
           best_points   = greatest(user_totals.best_points, excluded.best_points),
           best_accuracy = greatest(user_totals.best_accuracy, excluded.best_accuracy)
         returning total_points, total_plays, best_points, best_accuracy`,
        [run.userId, run.points, run.accuracy]
      );
      await client.query("commit");
      return { session: toSession(inserted.rows[0]), totals: toTotals(totals.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getProgress(userId: string): Promise<ProgressResponse> {
    const [totals, songs, recent] = await Promise.all([
      this.pool.query<TotalsRow>(
        `select total_points, total_plays, best_points, best_accuracy
         from user_totals where user_id = $1`,
        [userId]
      ),
      this.pool.query<{
        video_id: string;
        title: string | null;
        best_points: number;
        best_accuracy: number;
        plays: string;
        last_played_at: Date;
      }>(
        `select video_id,
                (array_agg(title order by played_at desc))[1] as title,
                max(points)    as best_points,
                max(accuracy)  as best_accuracy,
                count(*)       as plays,
                max(played_at) as last_played_at
         from play_sessions
         where user_id = $1
         group by video_id
         order by last_played_at desc
         limit ${SONG_LIMIT}`,
        [userId]
      ),
      this.pool.query<SessionRow>(
        `select ${SESSION_COLUMNS} from play_sessions
         where user_id = $1 order by played_at desc limit ${RECENT_LIMIT}`,
        [userId]
      ),
    ]);

    return {
      totals: toTotals(totals.rows[0]),
      songs: songs.rows.map(
        (row): SongBest => ({
          videoId: row.video_id,
          title: row.title,
          bestPoints: row.best_points,
          bestAccuracy: row.best_accuracy,
          plays: Number(row.plays),
          lastPlayedAt: row.last_played_at.toISOString(),
        })
      ),
      recent: recent.rows.map(toSession),
    };
  }

  async close() {
    await this.pool.end();
  }
}
