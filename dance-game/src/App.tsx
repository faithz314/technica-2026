import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Track } from "./playlistTracks";
import { AuthScreen } from "./screens/AuthScreen";
import { DanceScreen, type DanceMode, type RunResult } from "./screens/DanceScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import type {
  PlaylistMeta,
  ProgressResponse,
  PublicUser,
  ReferenceTrackSummary,
  SongBest,
} from "./shared/apiTypes";
import { DEFAULT_PLAYLIST_ID, PLAYLISTS } from "./shared/playlists";
import "./App.css";

type Screen = "library" | "dance" | "results" | "stats";

/** Shown until the server reports the playlists' real titles. */
const fallbackPlaylists: PlaylistMeta[] = PLAYLISTS.map((playlist) => ({
  id: playlist.id,
  name: playlist.fallbackName,
  blurb: playlist.blurb,
  accent: playlist.accent,
  symbol: playlist.symbol,
}));

function App() {
  // `undefined` while the stored session is being checked.
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [storage, setStorage] = useState<"memory" | "postgres" | null>(null);
  const [screen, setScreen] = useState<Screen>("library");
  const [playlists, setPlaylists] = useState(fallbackPlaylists);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(DEFAULT_PLAYLIST_ID);
  const [references, setReferences] = useState<ReadonlyMap<string, ReferenceTrackSummary>>(new Map());
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [progressError, setProgressError] = useState("");
  const [track, setTrack] = useState<Track | null>(null);
  const [danceMode, setDanceMode] = useState<DanceMode>("play");
  // Bumped to remount the dance screen for a fresh attempt at the same track.
  const [danceKey, setDanceKey] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    api.health().then((health) => setStorage(health.storage), () => setStorage(null));
    api.playlists().then(setPlaylists, () => {});
  }, []);

  const refreshProgress = useCallback(() => {
    api.progress().then(
      (loaded) => {
        setProgress(loaded);
        setProgressError("");
      },
      (error: unknown) =>
        setProgressError(error instanceof Error ? error.message : "Couldn't load your stats.")
    );
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .references()
      .then((list) => setReferences(new Map(list.map((entry) => [entry.videoId, entry]))))
      .catch(() => {});
    refreshProgress();
  }, [user, refreshProgress]);

  const bests = useMemo(
    () => new Map<string, SongBest>((progress?.songs ?? []).map((song) => [song.videoId, song])),
    [progress]
  );

  const accent =
    playlists.find((playlist) => playlist.id === (track?.playlistId ?? selectedPlaylistId))?.accent ??
    "#ff4e91";
  const playlistName =
    playlists.find((playlist) => playlist.id === track?.playlistId)?.name ?? "Just Dance";

  function openTrack(next: Track) {
    setTrack(next);
    setDanceMode(references.has(next.videoId) ? "play" : "record");
    setDanceKey((key) => key + 1);
    setScreen("dance");
  }

  function handleFinished(run: RunResult) {
    setResult(run);
    setScreen("results");
    if (run.saved) refreshProgress();
  }

  function handleReferenceSaved(summary: ReferenceTrackSummary) {
    setReferences((current) => new Map(current).set(summary.videoId, summary));
  }

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
    setProgress(null);
    setScreen("library");
  }

  if (user === undefined) {
    return (
      <div className="app-shell">
        <p className="boot-status">LOADING…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      {user && (
        <header className="topbar">
          <button className="brand" onClick={() => setScreen("library")} aria-label="Go to song library">
            <span className="brand-mark">✳</span>
            <span>
              MOVE<span className="brand-dot">!</span>
            </span>
          </button>
          <nav className="top-nav" aria-label="Main navigation">
            <button
              className={screen === "library" ? "nav-link active" : "nav-link"}
              onClick={() => setScreen("library")}
            >
              DISCOVER
            </button>
            <button
              className={screen === "stats" ? "nav-link active" : "nav-link"}
              onClick={() => {
                refreshProgress();
                setScreen("stats");
              }}
            >
              MY STATS
            </button>
            <span className="nav-divider" />
            <span className="player-chip">
              <span className="status-dot" /> {user.displayName.toUpperCase()} ·{" "}
              {(progress?.totals.totalPoints ?? 0).toLocaleString()} PTS
            </span>
          </nav>
          <button className="avatar-button" onClick={() => void signOut()} title="Sign out">
            {user.displayName.slice(0, 1).toUpperCase()}
          </button>
        </header>
      )}

      {!user && (
        <AuthScreen
          storage={storage}
          onSignedIn={(signedIn) => {
            setUser(signedIn);
            setScreen("library");
          }}
        />
      )}

      {user && screen === "library" && (
        <LibraryScreen
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          onSelectPlaylist={setSelectedPlaylistId}
          references={references}
          bests={bests}
          onPick={openTrack}
        />
      )}

      {user && screen === "dance" && track && (
        <DanceScreen
          key={danceKey}
          track={track}
          playlistName={playlistName}
          accent={accent}
          initialMode={danceMode}
          onBack={() => setScreen("library")}
          onFinished={handleFinished}
          onReferenceSaved={handleReferenceSaved}
        />
      )}

      {user && screen === "results" && result && (
        <ResultsScreen
          result={result}
          accent={accent}
          onAgain={() => openTrack(result.track)}
          onLibrary={() => setScreen("library")}
          onStats={() => setScreen("stats")}
        />
      )}

      {user && screen === "stats" && (
        <StatsScreen
          displayName={user.displayName}
          progress={progress}
          error={progressError}
          onRetry={refreshProgress}
        />
      )}

      <footer className="site-footer">
        <span>
          MOVE! <span className="brand-dot">✳</span>
        </span>
        <span>TECHNICA 2026</span>
      </footer>
    </div>
  );
}

export default App;
