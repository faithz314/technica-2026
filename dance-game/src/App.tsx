import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  JUST_DANCE_PLAYLIST_ID,
  PlayerState,
  createPlaylistPlayer,
  describePlayerError,
  type YouTubePlayer,
} from "./youtube";
import "./App.css";

type Screen = "auth" | "songs" | "dance" | "results";
type Difficulty = "Easy" | "Medium" | "Hard" | "Extreme";

type Song = {
  id: string;
  title: string;
  artist: string;
  difficulty: Difficulty;
  duration: string;
  generation: string;
  accent: string;
  videoId?: string;
  thumbnail?: string;
  label: string;
};

type Generation = {
  id: string;
  title: string;
  years: string;
  description: string;
  accent: string;
  symbol: string;
};

const generations: Generation[] = [
  {
    id: "classics",
    title: "THE CLASSICS",
    years: "2009–2013",
    description: "Iconic moves. Legendary tracks.",
    accent: "#ff4e91",
    symbol: "✳",
  },
  {
    id: "golden",
    title: "GOLDEN ERA",
    years: "2014–2018",
    description: "The party never stopped.",
    accent: "#ffb52e",
    symbol: "✦",
  },
  {
    id: "modern",
    title: "MODERN ERA",
    years: "2019–2022",
    description: "Big hits. Bigger energy.",
    accent: "#37d9ee",
    symbol: "✺",
  },
  {
    id: "new",
    title: "NEW SCHOOL",
    years: "2023–2026",
    description: "Fresh beats, fresh moves.",
    accent: "#b18cff",
    symbol: "✷",
  },
];
const songs: Song[] = [
  { id: "s1", title: "Neon Nights", artist: "The Electric Hearts", difficulty: "Easy", duration: "3:12", generation: "classics", accent: "#ff4e91", label: "PARTY STARTER", videoId: "" },
  { id: "s2", title: "Rhythm Riot", artist: "DJ Voltage", difficulty: "Hard", duration: "3:34", generation: "classics", accent: "#ff783d", label: "FAN FAVORITE", videoId: "" },
  { id: "s3", title: "Golden Hour", artist: "Luna Bloom", difficulty: "Medium", duration: "3:01", generation: "golden", accent: "#ffb52e", label: "FEEL GOOD", videoId: "" },
  { id: "s4", title: "Electric Fever", artist: "Kira Nova", difficulty: "Extreme", duration: "3:48", generation: "golden", accent: "#f254d8", label: "EXPERT MODE", videoId: "" },
  { id: "s5", title: "Pixel Heart", artist: "Mika Motion", difficulty: "Medium", duration: "2:58", generation: "modern", accent: "#37d9ee", label: "TRENDING", videoId: "" },
  { id: "s6", title: "Supernova", artist: "Star Arcade", difficulty: "Hard", duration: "3:26", generation: "modern", accent: "#5278ff", label: "HIGH ENERGY", videoId: "" },
  { id: "s7", title: "Candy Comet", artist: "Sugar Rush", difficulty: "Easy", duration: "3:08", generation: "new", accent: "#b18cff", label: "GOOD VIBES", videoId: "" },
  { id: "s8", title: "Afterglow", artist: "Velvet Sky", difficulty: "Extreme", duration: "3:41", generation: "new", accent: "#61e6a6", label: "CHALLENGE", videoId: "" },
];

function getGeneration(id: string) {
  return generations.find((generation) => generation.id === id) ?? generations[0];
}

function getDifficultyClass(difficulty: Difficulty) {
  return difficulty.toLowerCase();
}

type PlaylistMeta = {
  title: string;
  author: string;
  index: number;
  count: number;
};

const emptyMeta: PlaylistMeta = { title: "", author: "", index: 0, count: 0 };

/**
 * Mounts a real YouTube IFrame player bound to the Just Dance playlist and
 * drives it through the player API. No Data API key is used — titles, the
 * current index and the playlist length are read back off the live player.
 */
function PlaylistStage({ accent }: { accent: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [meta, setMeta] = useState<PlaylistMeta>(emptyMeta);
  const [error, setError] = useState("");

  const readMeta = useCallback((player: YouTubePlayer) => {
    const data = player.getVideoData();
    setMeta({
      title: data.title || "",
      author: data.author || "",
      index: player.getPlaylistIndex(),
      count: player.getPlaylist()?.length ?? 0,
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let player: YouTubePlayer | null = null;

    // The API replaces the element it is given with an iframe, so hand it a
    // throwaway child and clear the host on teardown. That also means
    // StrictMode's second effect run starts from an empty host instead of
    // stacking a second iframe.
    const mount = document.createElement("div");
    host.replaceChildren(mount);

    void createPlaylistPlayer(mount, {
      width: "100%",
      height: "100%",
      playerVars: {
        listType: "playlist",
        list: JUST_DANCE_PLAYLIST_ID,
        autoplay: 0,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          if (cancelled) return;
          setReady(true);
          setError("");
          readMeta(event.target);
        },
        onStateChange: (event) => {
          if (cancelled) return;
          setPlaying(event.data === PlayerState.PLAYING);
          if (event.data === PlayerState.PLAYING) setError("");
          readMeta(event.target);
        },
        onError: (event) => {
          if (cancelled) return;
          setError(describePlayerError(event.data));
          readMeta(event.target);
        },
      },
    })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        player = created;
        playerRef.current = created;
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The YouTube player failed to load."
        );
      });

    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [readMeta]);

  function togglePlay() {
    const player = playerRef.current;
    if (!player) return;
    if (player.getPlayerState() === PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }

  function goNext() {
    setError("");
    playerRef.current?.nextVideo();
  }

  function goPrevious() {
    setError("");
    playerRef.current?.previousVideo();
  }

  function jumpTo(index: number) {
    setError("");
    playerRef.current?.playVideoAt(index);
  }

  const positionLabel =
    meta.count > 0
      ? `TRACK ${String(meta.index + 1).padStart(2, "0")} / ${String(
          meta.count
        ).padStart(2, "0")}`
      : "LOADING PLAYLIST…";

  return (
    <section className="video-stage" style={{ "--accent": accent } as React.CSSProperties}>
      <div className="stage-topbar">
        <span>
          <span className="status-dot" /> COACH VIEW
        </span>
        <span>{positionLabel}</span>
      </div>

      <div className="dance-video-frame" ref={hostRef} />

      {!ready && !error && (
        <p className="playlist-status">Connecting to the YouTube playlist…</p>
      )}

      {error && (
        <div className="playlist-player-error" role="alert">
          <strong>CAN'T PLAY THIS TRACK</strong>
          <p>{error}</p>
          <button className="text-button" onClick={goNext}>
            SKIP TO NEXT TRACK ↗
          </button>
        </div>
      )}

      <div className="playlist-now">
        <span className="eyebrow small-eyebrow">NOW ON THE PLAYLIST</span>
        <strong>{meta.title || "—"}</strong>
        <span className="playlist-author">{meta.author || "YouTube"}</span>
      </div>

      <div className="playlist-controls">
        <button
          className="secondary-button"
          onClick={goPrevious}
          disabled={!ready}
        >
          PREVIOUS <span>⏮</span>
        </button>
        <button className="primary-button" onClick={togglePlay} disabled={!ready}>
          {playing ? "PAUSE" : "PLAY"} <span>{playing ? "Ⅱ" : "▶"}</span>
        </button>
        <button className="secondary-button" onClick={goNext} disabled={!ready}>
          NEXT <span>⏭</span>
        </button>
        <label className="playlist-jump">
          JUMP TO
          <select
            value={meta.count > 0 ? meta.index : 0}
            onChange={(event) => jumpTo(Number(event.target.value))}
            disabled={meta.count === 0}
            aria-label="Jump to playlist position"
          >
            {meta.count > 0 ? (
              Array.from({ length: meta.count }, (_, position) => (
                <option key={position} value={position}>
                  {String(position + 1).padStart(2, "0")}
                </option>
              ))
            ) : (
              <option value={0}>—</option>
            )}
          </select>
        </label>
      </div>

      <div className="stage-footer">
        <span>MOVE WITH THE MUSIC</span>
        <span>♪ ♫ ♪</span>
      </div>
    </section>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [selectedGeneration, setSelectedGeneration] = useState("classics");
  const [selectedSong, setSelectedSong] = useState<Song>(songs[0]);
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("All");
  const [score, setScore] = useState(0);
  const [danceStarted, setDanceStarted] = useState(false);

  const visibleSongs = useMemo(() => {
    const sourceSongs = songs.filter(
      (song) => song.generation === selectedGeneration
    );

    return sourceSongs.filter((song) => {
      const query = search.trim().toLowerCase();

      const matchesSearch =
        !query ||
        `${song.title} ${song.artist}`.toLowerCase().includes(query);

      const matchesDifficulty =
        difficulty === "All" || song.difficulty === difficulty;

      return matchesSearch && matchesDifficulty;
    });
  }, [selectedGeneration, search, difficulty]);

  function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (!email.includes("@")) {
      setAuthError("Enter a valid email address to continue.");
      return;
    }
    if (password.length < 6) {
      setAuthError("Use at least 6 characters for this demo.");
      return;
    }
    if (isSignup && displayName.trim().length < 2) {
      setAuthError("Add a display name (at least 2 characters).");
      return;
    }
    setScreen("songs");
  }

  function startDance(song: Song) {
    setSelectedSong(song);
    setDanceStarted(false);
    setScreen("dance");
  }

  function finishDance() {
    setScore(Math.floor(65000 + Math.random() * 35000));
    setScreen("results");
  }

  function returnToSongs() {
    setScreen("songs");
    setDanceStarted(false);
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      {screen !== "auth" && (
        <header className="topbar">
          <button className="brand" onClick={returnToSongs} aria-label="Go to song library">
            <span className="brand-mark">✳</span>
            <span>MOVE<span className="brand-dot">!</span></span>
          </button>
          <nav className="top-nav" aria-label="Main navigation">
            <button className={screen === "songs" ? "nav-link active" : "nav-link"} onClick={returnToSongs}>DISCOVER</button>
            <span className="nav-divider" />
            <span className="player-chip"><span className="status-dot" /> PLAYER 01</span>
          </nav>
          <button className="avatar-button" onClick={() => setScreen("auth")} title="Sign out">
            {(displayName || email.split("@")[0] || "D").slice(0, 1).toUpperCase()}
          </button>
        </header>
      )}

      {screen === "auth" && (
        <main className="auth-screen">
          <section className="auth-copy">
            <div className="eyebrow"><span className="eyebrow-star">✦</span> YOUR ROOM. YOUR STAGE.</div>
            <h1>FEEL THE<br /><span className="gradient-text">BEAT.</span><br />OWN THE<br />FLOOR.</h1>
            <p className="hero-description">Turn your space into a dance floor. Pick a track, follow the moves, and show the world what you’ve got.</p>
            <div className="hero-stats">
              <div><strong>01</strong><span>CHOOSE A BEAT</span></div>
              <div><strong>02</strong><span>MOVE YOUR WAY</span></div>
              <div><strong>03</strong><span>CHASE YOUR SCORE</span></div>
            </div>
          </section>
          <section className="auth-panel">
            <div className="panel-kicker">LET'S GET MOVING</div>
            <h2>{isSignup ? "JOIN THE PARTY" : "READY TO PLAY?"}</h2>
            <p className="muted">{isSignup ? "Create your player profile." : "Your next favorite dance is waiting."}</p>
            <form className="auth-form" onSubmit={handleAuth}>
              {isSignup && (
                <label className="field-label">PLAYER NAME
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="What should we call you?" autoComplete="nickname" />
                </label>
              )}
              <label className="field-label">EMAIL ADDRESS
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" autoComplete="email" required />
              </label>
              <label className="field-label">PASSWORD
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="At least 6 characters" autoComplete={isSignup ? "new-password" : "current-password"} required />
              </label>
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="primary-button full-button" type="submit">{isSignup ? "CREATE PLAYER PROFILE" : "LET'S DANCE"} <span>↗</span></button>
            </form>
            <div className="auth-switch">{isSignup ? "Already on the floor?" : "New to the dance floor?"} <button onClick={() => { setIsSignup(!isSignup); setAuthError(""); }}>{isSignup ? "Sign in" : "Create an account"}</button></div>
            <p className="demo-note">DEMO MODE · NO ACCOUNT IS CREATED</p>
          </section>
          <div className="auth-decoration deco-star">✳</div>
          <div className="auth-decoration deco-circle" />
          <div className="auth-bottom-note">TURN IT UP <span>↗</span></div>
        </main>
      )}

      {screen === "songs" && (
        <main className="library-screen page-wrap">
          <section className="library-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-star">✦</span> THE DANCE FLOOR IS YOURS</div>
              <h1>PICK YOUR <span className="gradient-text">ERA.</span></h1>
              <p className="muted">Every generation has a beat. Find yours.</p>
            </div>
            <div className="library-count"><strong>08</strong><span>DEMO TRACKS<br />IN THE MIX</span></div>
          </section>

          <section className="generation-grid" aria-label="Choose a dance generation">
            {generations.map((generation, index) => (
              <button
                key={generation.id}
                className={`generation-card ${selectedGeneration === generation.id ? "selected" : ""}`}
                style={{ "--accent": generation.accent } as React.CSSProperties}
                onClick={() => setSelectedGeneration(generation.id)}
                aria-pressed={selectedGeneration === generation.id}
              >
                <span className="generation-number">0{index + 1} / ERA</span>
                <span className="generation-art" aria-hidden="true">{generation.symbol}</span>
                <span className="generation-info">
                  <span className="generation-years">{generation.years}</span>
                  <strong>{generation.title}</strong>
                  <span className="generation-description">{generation.description}</span>
                </span>
                <span className="generation-arrow">↗</span>
              </button>
            ))}
          </section>

          <section className="song-section">
            <div className="song-section-heading">
              <div>
                <div className="eyebrow small-eyebrow">NOW PLAYING IN YOUR HEAD</div>
                <h2>{getGeneration(selectedGeneration).title} <span className="heading-slash">/</span> TRACKS</h2>
              </div>
              <div className="song-controls">
                <label className="search-box">
                  <span>⌕</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a song..." aria-label="Search songs" />
                </label>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} aria-label="Filter by difficulty">
                  <option>All</option><option>Easy</option><option>Medium</option><option>Hard</option><option>Extreme</option>
                </select>
              </div>
            </div>

            {visibleSongs.length > 0 ? (
              <div className="song-grid">
                {visibleSongs.map((song, index) => (
                  <button key={song.id} className="song-card" onClick={() => startDance(song)} style={{ "--accent": song.accent } as React.CSSProperties}>
                    <div className="song-art">
                      {song.thumbnail && (
                        <img
                          className="youtube-thumbnail"
                          src={song.thumbnail}
                          alt=""
                          loading="lazy"
                        />
                      )}
                      <span className="song-index">TRACK {String(index + 1).padStart(2, "0")}</span>
                      <span className="song-art-shape shape-one" />
                      <span className="song-art-shape shape-two" />
                      <span className="song-art-symbol">{["✳", "✦", "✺", "✷"][index % 4]}</span>
                      <span className="song-art-label">{song.label}</span>
                      <span className="play-disc">▶</span>
                    </div>
                    <div className="song-card-details">
                      <div className="song-title-row"><h3>{song.title}</h3><span className={`difficulty ${getDifficultyClass(song.difficulty)}`}>{song.difficulty}</span></div>
                      <p>{song.artist}</p>
                      <div className="song-meta"><span>♫ DANCE TRACK</span><span>{song.duration}</span></div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state"><span>✳</span><h3>NO TRACKS FOUND</h3><p>Try another search or difficulty.</p><button className="text-button" onClick={() => { setSearch(""); setDifficulty("All"); }}>CLEAR FILTERS ↗</button></div>
            )}
          </section>
          <div className="playlist-note"><span className="note-icon">♫</span><span><strong>REAL PLAYLIST ON THE STAGE</strong><br />These cards are demo tracks, but every dance session streams the live Just Dance YouTube playlist — play, skip and jump between its videos from the stage.</span></div>
        </main>
      )}

      {screen === "dance" && (
        <main className="dance-screen page-wrap">
          <div className="dance-topline">
            <button className="back-button" onClick={returnToSongs}>← BACK TO TRACKS</button>
            <span className="live-pill"><span className="status-dot" /> DANCE SESSION</span>
          </div>
          <section className="dance-title-row">
            <div><div className="eyebrow">YOUR STAGE IS SET</div><h1>{selectedSong.title.toUpperCase()}</h1><p className="muted">{selectedSong.artist} <span className="heading-slash">/</span> {selectedSong.duration}</p></div>
            <span className={`difficulty large-difficulty ${getDifficultyClass(selectedSong.difficulty)}`}>{selectedSong.difficulty}</span>
          </section>
          <div className="dance-layout">
            <PlaylistStage accent={selectedSong.accent} />
            <aside className="player-stage">
              <div className="player-stage-header"><span>PLAYER CAMERA</span><span className="camera-indicator">● OFFLINE</span></div>
              <div className="camera-placeholder"><div className="camera-frame"><span className="camera-cross">＋</span><span className="camera-person">♙</span></div><strong>YOUR SPOTLIGHT</strong><p>Webcam body tracking will appear here.</p></div>
              <div className="score-preview"><span>LIVE SCORE</span><strong>— — —</strong><small>WARM UP THOSE MOVES</small></div>
              <button className="primary-button full-button" onClick={() => setDanceStarted(!danceStarted)}>{danceStarted ? "PAUSE DEMO" : "START DANCE"} <span>{danceStarted ? "Ⅱ" : "▶"}</span></button>
              {danceStarted && <p className="demo-playing"><span className="status-dot" /> Demo session started — camera scoring is not connected yet.</p>}
              <button className="secondary-button full-button" onClick={finishDance}>FINISH DEMO & SEE SCORE ↗</button>
            </aside>
          </div>
          <p className="dance-disclaimer">Prototype mode: scores are simulated. Webcam access and pose-matching are not connected yet.</p>
        </main>
      )}

      {screen === "results" && (
        <main className="results-screen page-wrap">
          <div className="results-confetti confetti-one">✦</div><div className="results-confetti confetti-two">✳</div><div className="results-confetti confetti-three">✷</div>
          <div className="eyebrow"><span className="eyebrow-star">✦</span> THAT WAS A VIBE</div>
          <h1>YOU OWNED<br /><span className="gradient-text">THE FLOOR.</span></h1>
          <p className="muted results-subtitle">Every move counts. Here's how your session went.</p>
          <section className="result-card">
            <div className="result-song-art" style={{ "--accent": selectedSong.accent } as React.CSSProperties}><span>{selectedSong.title}</span><b>✳</b></div>
            <div className="result-details"><span className="eyebrow small-eyebrow">FINAL SCORE</span><strong className="score-number">{score.toLocaleString()}</strong><span className="score-caption">POINTS EARNED</span><div className="result-divider" /><p>{selectedSong.title} <span className="heading-slash">/</span> {selectedSong.artist}</p><span className={`difficulty ${getDifficultyClass(selectedSong.difficulty)}`}>{selectedSong.difficulty}</span></div>
          </section>
          <div className="result-actions"><button className="primary-button" onClick={() => startDance(selectedSong)}>DANCE AGAIN <span>↻</span></button><button className="secondary-button" onClick={returnToSongs}>CHOOSE ANOTHER TRACK ↗</button></div>
          <p className="demo-note result-note">DEMO SCORE · RANDOMLY GENERATED FOR PROTOTYPING</p>
        </main>
      )}

      <footer className="site-footer"><span>MOVE! <span className="brand-dot">✳</span></span><span>MADE TO MOVE YOU</span><span>TECHNICA 2026 · PROTOTYPE</span></footer>
    </div>
  );
}

export default App;
