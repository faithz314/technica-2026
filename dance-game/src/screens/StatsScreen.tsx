import type { ProgressResponse } from "../shared/apiTypes";
import { thumbnailUrl } from "../shared/playlists";

type Props = {
  displayName: string;
  progress: ProgressResponse | null;
  error: string;
  onRetry(): void;
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StatsScreen({ displayName, progress, error, onRetry }: Props) {
  return (
    <main className="stats-screen page-wrap">
      <div className="eyebrow">
        <span className="eyebrow-star">✦</span> PLAYER PROFILE
      </div>
      <h1>
        {displayName.toUpperCase()}
        <span className="gradient-text">.</span>
      </h1>

      {error && (
        <div className="empty-state" role="alert">
          <span>✳</span>
          <h3>COULDN'T LOAD YOUR STATS</h3>
          <p>{error}</p>
          <button className="text-button" onClick={onRetry}>
            TRY AGAIN ↗
          </button>
        </div>
      )}

      {!error && !progress && <p className="muted">Loading your stats…</p>}

      {progress && (
        <>
          <section className="totals-strip" aria-label="Career totals">
            <div>
              <strong>{progress.totals.totalPoints.toLocaleString()}</strong>
              <span>CAREER POINTS</span>
            </div>
            <div>
              <strong>{progress.totals.totalPlays}</strong>
              <span>DANCES</span>
            </div>
            <div>
              <strong>{progress.totals.bestPoints.toLocaleString()}</strong>
              <span>PERSONAL BEST</span>
            </div>
            <div>
              <strong>{percent(progress.totals.bestAccuracy)}</strong>
              <span>BEST ACCURACY</span>
            </div>
          </section>

          <section className="stats-columns">
            <div>
              <h2>
                SONG BESTS <span className="heading-slash">/</span>
              </h2>
              {progress.songs.length === 0 ? (
                <p className="muted">No dances yet. Pick a track with a recorded routine!</p>
              ) : (
                <ul className="stats-list">
                  {progress.songs.map((song) => (
                    <li key={song.videoId}>
                      <img src={thumbnailUrl(song.videoId)} alt="" loading="lazy" />
                      <span className="stats-title">
                        <strong>{song.title ?? song.videoId}</strong>
                        <small>
                          {song.plays} PLAY{song.plays === 1 ? "" : "S"} · BEST {percent(song.bestAccuracy)}
                        </small>
                      </span>
                      <b>{song.bestPoints.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h2>
                RECENT <span className="heading-slash">/</span>
              </h2>
              {progress.recent.length === 0 ? (
                <p className="muted">Your latest runs will show up here.</p>
              ) : (
                <ul className="stats-list">
                  {progress.recent.map((run) => (
                    <li key={run.id}>
                      <span className="grade-chip">{run.grade}</span>
                      <span className="stats-title">
                        <strong>{run.title ?? run.videoId}</strong>
                        <small>
                          {when(run.playedAt)} · {percent(run.accuracy)} · {run.maxCombo} COMBO
                        </small>
                      </span>
                      <b>{run.points.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
