import { useEffect, useMemo, useState } from "react";
import { loadPlaylistTracks, type Track } from "../playlistTracks";
import type { PlaylistMeta, ReferenceTrackSummary, SongBest } from "../shared/apiTypes";

type Filter = "all" | "ready" | "missing";

type Props = {
  playlists: PlaylistMeta[];
  selectedPlaylistId: string;
  onSelectPlaylist(id: string): void;
  references: ReadonlyMap<string, ReferenceTrackSummary>;
  bests: ReadonlyMap<string, SongBest>;
  onPick(track: Track): void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tracks: Track[] };

/** A settled load, tagged with the request it answers. */
type Settled = { key: string; state: LoadState };

const trackCache = new Map<string, Promise<Track[]>>();

function tracksFor(playlistId: string) {
  let pending = trackCache.get(playlistId);
  if (!pending) {
    pending = loadPlaylistTracks(playlistId);
    // A failed load shouldn't stick: let the retry button try again.
    pending.catch(() => trackCache.delete(playlistId));
    trackCache.set(playlistId, pending);
  }
  return pending;
}

export function LibraryScreen({
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  references,
  bests,
  onPick,
}: Props) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadKey = `${selectedPlaylistId}#${attempt}`;
  // Anything not yet answered for the current playlist and attempt is loading.
  const load: LoadState =
    settled?.key === loadKey ? settled.state : { status: "loading" };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const playlist = playlists.find((entry) => entry.id === selectedPlaylistId) ?? playlists[0];

  useEffect(() => {
    let cancelled = false;
    tracksFor(selectedPlaylistId)
      .then((tracks) => {
        if (!cancelled) setSettled({ key: loadKey, state: { status: "ready", tracks } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSettled({
            key: loadKey,
            state: {
              status: "error",
              message: error instanceof Error ? error.message : "Couldn't load this playlist.",
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlaylistId, loadKey]);

  const tracks = load.status === "ready" ? load.tracks : null;

  const visible = useMemo(() => {
    if (!tracks) return [];
    const query = search.trim().toLowerCase();
    return tracks.filter((track) => {
      const ready = references.has(track.videoId);
      if (filter === "ready" && !ready) return false;
      if (filter === "missing" && ready) return false;
      return !query || `${track.title ?? ""} ${track.author ?? ""}`.toLowerCase().includes(query);
    });
  }, [tracks, search, filter, references]);

  const readyCount =
    load.status === "ready"
      ? load.tracks.filter((track) => references.has(track.videoId)).length
      : 0;

  return (
    <main className="library-screen page-wrap">
      <section className="library-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-star">✦</span> THE DANCE FLOOR IS YOURS
          </div>
          <h1>
            PICK YOUR <span className="gradient-text">PLAYLIST.</span>
          </h1>
          <p className="muted">Real Just Dance routines, streamed straight from YouTube.</p>
        </div>
        <div className="library-count">
          <strong>{load.status === "ready" ? String(load.tracks.length).padStart(2, "0") : "––"}</strong>
          <span>
            TRACKS IN
            <br />
            THIS PLAYLIST
          </span>
        </div>
      </section>

      <section className="playlist-grid" aria-label="Choose a playlist">
        {playlists.map((entry, index) => (
          <button
            key={entry.id}
            className={`generation-card ${entry.id === selectedPlaylistId ? "selected" : ""}`}
            style={{ "--accent": entry.accent } as React.CSSProperties}
            onClick={() => onSelectPlaylist(entry.id)}
            aria-pressed={entry.id === selectedPlaylistId}
          >
            <span className="generation-number">0{index + 1} / PLAYLIST</span>
            <span className="generation-art" aria-hidden="true">
              {entry.symbol}
            </span>
            <span className="generation-info">
              <span className="generation-years">YOUTUBE PLAYLIST</span>
              <strong>{entry.name}</strong>
              <span className="generation-description">{entry.blurb}</span>
            </span>
            <span className="generation-arrow">↗</span>
          </button>
        ))}
      </section>

      <section className="song-section">
        <div className="song-section-heading">
          <div>
            <div className="eyebrow small-eyebrow">
              {readyCount} OF {load.status === "ready" ? load.tracks.length : "–"} ROUTINES RECORDED
            </div>
            <h2>
              {playlist?.name ?? "PLAYLIST"} <span className="heading-slash">/</span> TRACKS
            </h2>
          </div>
          <div className="song-controls">
            <label className="search-box">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a song..."
                aria-label="Search songs"
              />
            </label>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
              aria-label="Filter by routine"
            >
              <option value="all">All tracks</option>
              <option value="ready">Routine ready</option>
              <option value="missing">Needs routine</option>
            </select>
          </div>
        </div>

        {load.status === "loading" && (
          <div className="empty-state">
            <span>♫</span>
            <h3>LOADING THE PLAYLIST…</h3>
            <p>Asking YouTube for the track list.</p>
          </div>
        )}

        {load.status === "error" && (
          <div className="empty-state" role="alert">
            <span>✳</span>
            <h3>COULDN'T LOAD THIS PLAYLIST</h3>
            <p>{load.message}</p>
            <button className="text-button" onClick={() => setAttempt((n) => n + 1)}>
              TRY AGAIN ↗
            </button>
          </div>
        )}

        {load.status === "ready" &&
          (visible.length > 0 ? (
            <div className="song-grid">
              {visible.map((track) => {
                const ready = references.has(track.videoId);
                const best = bests.get(track.videoId);
                return (
                  <button
                    key={track.videoId}
                    className="song-card"
                    onClick={() => onPick(track)}
                    style={{ "--accent": playlist?.accent ?? "#ff4e91" } as React.CSSProperties}
                  >
                    <div className="song-art">
                      <img className="youtube-thumbnail" src={track.thumbnailUrl} alt="" loading="lazy" />
                      <span className="song-index">TRACK {String(track.index + 1).padStart(2, "0")}</span>
                      <span className="song-art-label">{ready ? "DANCE FOR SCORE" : "RECORD THE ROUTINE"}</span>
                      <span className="play-disc">{ready ? "▶" : "●"}</span>
                    </div>
                    <div className="song-card-details">
                      <div className="song-title-row">
                        <h3>{track.title ?? `Track ${track.index + 1}`}</h3>
                        <span className={`routine-badge ${ready ? "ready" : "missing"}`}>
                          {ready ? "READY" : "NEW"}
                        </span>
                      </div>
                      <p>{track.author ?? "YouTube"}</p>
                      <div className="song-meta">
                        <span>{best ? `BEST ${best.bestPoints.toLocaleString()}` : "NOT PLAYED YET"}</span>
                        <span>{best ? `${best.plays} PLAY${best.plays === 1 ? "" : "S"}` : "♫"}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <span>✳</span>
              <h3>NO TRACKS FOUND</h3>
              <p>Try another search or filter.</p>
              <button
                className="text-button"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                CLEAR FILTERS ↗
              </button>
            </div>
          ))}
      </section>

    </main>
  );
}
