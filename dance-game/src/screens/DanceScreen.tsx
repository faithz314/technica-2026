import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { api, ApiError } from "../api";
import { ScoreKeeper, type ScoreSnapshot } from "../game/scoreKeeper";
import { VideoClock } from "../game/videoClock";
import type { Track } from "../playlistTracks";
import { drawPose } from "../pose/drawPose";
import { compactFrame, extractFeatures, matchAt, type Landmark, type PoseFeatures } from "../pose/features";
import { detectPose, loadPoseLandmarker, openWebcam, stopStream } from "../pose/poseTracker";
import type {
  ReferenceFrame,
  ReferenceTrack,
  ReferenceTrackSummary,
  SubmitRunResponse,
} from "../shared/apiTypes";
import {
  REFERENCE_SAMPLE_RATE_HZ,
  SCORE_SAMPLE_RATE_HZ,
  type Tier,
} from "../shared/scoring";
import { PlayerState, createPlayer, describePlayerError, type YouTubePlayer } from "../youtube";

export type DanceMode = "play" | "record";

export type RunResult = {
  track: Track;
  snapshot: ScoreSnapshot;
  saved: SubmitRunResponse | null;
  saveError: string | null;
};

type Props = {
  track: Track;
  playlistName: string;
  accent: string;
  initialMode: DanceMode;
  onBack(): void;
  onFinished(result: RunResult): void;
  onReferenceSaved(summary: ReferenceTrackSummary): void;
};

type CameraStatus = "off" | "starting" | "on" | "error";

/** A pose older than this is treated as "no one in frame". */
const POSE_STALE_MS = 300;
/** Must match the server's minimum so a short take isn't rejected after the fact. */
const MIN_REFERENCE_FRAMES = 30;
const COUNTDOWN_FROM = 3;
const FLASH_REPEAT_MS = 900;

const SCORE_SLOT_MS = 1000 / SCORE_SAMPLE_RATE_HZ;
const RECORD_SLOT_MS = 1000 / REFERENCE_SAMPLE_RATE_HZ;

const emptySnapshot = new ScoreKeeper().snapshot();

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function DanceScreen({
  track,
  playlistName,
  accent,
  initialMode,
  onBack,
  onFinished,
  onReferenceSaved,
}: Props) {
  const [mode, setMode] = useState<DanceMode>(initialMode);
  const [reference, setReference] = useState<ReferenceTrack | null | undefined>(undefined);
  const [referenceError, setReferenceError] = useState("");

  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState("");

  const [camera, setCamera] = useState<CameraStatus>("off");
  const [cameraError, setCameraError] = useState("");
  const [landmarker, setLandmarker] = useState<PoseLandmarker | null>(null);
  const [personVisible, setPersonVisible] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [live, setLive] = useState<ScoreSnapshot>(emptySnapshot);
  const [flash, setFlash] = useState<{ tier: Tier; id: number } | null>(null);
  const [recordedFrames, setRecordedFrames] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const webcamRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // The animation loop reads these instead of state so it never sees stale values.
  const modeRef = useRef(mode);
  const referenceRef = useRef<ReferenceTrack | null>(null);
  const keeperRef = useRef(new ScoreKeeper());
  const recordingRef = useRef(new Map<number, ReferenceFrame>());
  const clockRef = useRef(new VideoClock());
  const finishRef = useRef<() => void>(() => {});
  const lastPositionUpdateRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    referenceRef.current = reference ?? null;
  }, [reference]);

  // Reference routine for this video. The parent remounts this screen per
  // track, so these effects never need to reset state for a new video.
  useEffect(() => {
    let cancelled = false;
    api
      .reference(track.videoId)
      .then((loaded) => {
        if (cancelled) return;
        setReference(loaded);
        if (!loaded) setMode((current) => (current === "play" ? "record" : current));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReference(null);
        setReferenceError(error instanceof Error ? error.message : "Couldn't load the routine.");
      });
    return () => {
      cancelled = true;
    };
  }, [track.videoId]);

  // The coach video.
  useEffect(() => {
    const host = playerHostRef.current;
    if (!host) return;
    let cancelled = false;
    let player: YouTubePlayer | null = null;
    const mount = document.createElement("div");
    host.replaceChildren(mount);

    void createPlayer(mount, {
      width: "100%",
      height: "100%",
      videoId: track.videoId,
      playerVars: {
        autoplay: 0,
        // Seeking would let a player re-dance the easy bits; transport is ours.
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          if (!cancelled) setPlayerReady(true);
        },
        onStateChange: (event) => {
          if (cancelled) return;
          setPlaying(event.data === PlayerState.PLAYING);
          if (event.data === PlayerState.ENDED) finishRef.current();
        },
        onError: (event) => {
          if (!cancelled) setVideoError(describePlayerError(event.data));
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
      .catch((error: unknown) => {
        if (!cancelled) {
          setVideoError(error instanceof Error ? error.message : "The YouTube player failed to load.");
        }
      });

    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [track.videoId]);

  // Release the webcam when leaving the screen.
  useEffect(() => () => stopStream(streamRef.current), []);

  const enableCamera = useCallback(async () => {
    const video = webcamRef.current;
    if (!video || camera === "starting" || camera === "on") return camera === "on";
    setCamera("starting");
    setCameraError("");
    try {
      const [stream, model] = await Promise.all([openWebcam(video), loadPoseLandmarker()]);
      streamRef.current = stream;
      setLandmarker(model);
      setCamera("on");
      return true;
    } catch (error) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setCamera("error");
      setCameraError(
        error instanceof Error ? error.message : "Couldn't start pose tracking on this device."
      );
      return false;
    }
  }, [camera]);

  // Pose detection, recording and scoring, once per animation frame.
  useEffect(() => {
    const video = webcamRef.current;
    const canvas = canvasRef.current;
    if (camera !== "on" || !landmarker || !video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let lastVideoTime = -1;
    let landmarks: Landmark[] | null = null;
    let features: PoseFeatures | null = null;
    let poseAt = 0;
    let segments: (number | null)[] | null = null;
    let visible = false;
    let flashedTier: Tier | null = null;
    let flashedAt = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();

      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
        try {
          landmarks = detectPose(landmarker, video, now);
        } catch {
          landmarks = null;
        }
        if (landmarks) {
          features = extractFeatures(landmarks, video.videoWidth / video.videoHeight);
          poseAt = now;
        }
        drawPose(ctx, landmarks, modeRef.current === "play" ? segments : null);
        const nowVisible = landmarks !== null;
        if (nowVisible !== visible) {
          visible = nowVisible;
          setPersonVisible(nowVisible);
        }
      }

      const player = playerRef.current;
      if (!player || player.getPlayerState() !== PlayerState.PLAYING) return;
      const tMs = clockRef.current.read(player.getCurrentTime(), true, now);
      const pose = now - poseAt <= POSE_STALE_MS ? features : null;

      if (now - lastPositionUpdateRef.current > 250) {
        lastPositionUpdateRef.current = now;
        setPositionMs(tMs);
      }

      if (modeRef.current === "record") {
        const slot = Math.floor(tMs / RECORD_SLOT_MS);
        const recording = recordingRef.current;
        // Gaps are fine: attempts skip any moment the reference didn't capture.
        if (pose && !recording.has(slot)) {
          recording.set(slot, compactFrame(tMs, pose));
          setRecordedFrames(recording.size);
        }
        return;
      }

      const track = referenceRef.current;
      const keeper = keeperRef.current;
      const slot = Math.floor(tMs / SCORE_SLOT_MS);
      if (!track || keeper.hasScored(slot)) return;
      const match = matchAt(track, tMs, pose);
      if (!match) return;
      segments = match.segments;
      const tier = keeper.add(slot, match.score);
      setLive(keeper.snapshot());
      // Re-trigger the callout when the verdict changes, or as a steady pulse.
      if (tier !== flashedTier || now - flashedAt > FLASH_REPEAT_MS) {
        flashedTier = tier;
        flashedAt = now;
        setFlash({ tier, id: slot });
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [camera, landmarker]);

  // 3-2-1, then roll the video.
  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(null);
      playerRef.current?.playVideo();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function resetTake() {
    keeperRef.current = new ScoreKeeper();
    recordingRef.current = new Map();
    clockRef.current = new VideoClock();
    setLive(emptySnapshot);
    setFlash(null);
    setRecordedFrames(0);
    setPositionMs(0);
  }

  async function start() {
    setNotice("");
    if (!(await enableCamera())) return;
    setCountdown(COUNTDOWN_FROM);
  }

  function pause() {
    setCountdown(null);
    playerRef.current?.pauseVideo();
  }

  function restart() {
    pause();
    playerRef.current?.seekTo(0, true);
    resetTake();
  }

  function switchMode(next: DanceMode) {
    if (next === mode) return;
    restart();
    setNotice("");
    setMode(next);
  }

  function videoDurationMs() {
    const seconds = playerRef.current?.getDuration() ?? 0;
    return Math.max(1, Math.round(seconds * 1000), Math.round(positionMs));
  }

  async function saveReference() {
    const frames = [...recordingRef.current.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, frame]) => frame);
    if (frames.length < MIN_REFERENCE_FRAMES) {
      setNotice("Dance a little longer before saving — the routine needs a few seconds of moves.");
      return;
    }
    setBusy(true);
    try {
      const durationMs = videoDurationMs();
      const summary = await api.saveReference(track.videoId, {
        playlistId: track.playlistId,
        title: track.title,
        sampleRateHz: REFERENCE_SAMPLE_RATE_HZ,
        durationMs,
        frames,
      });
      setReference({
        videoId: track.videoId,
        playlistId: track.playlistId,
        title: track.title,
        sampleRateHz: REFERENCE_SAMPLE_RATE_HZ,
        durationMs,
        frames,
        updatedAt: summary.updatedAt,
      });
      onReferenceSaved(summary);
      restart();
      setMode("play");
      setNotice(`Routine saved — ${frames.length} poses captured. Now dance it for a score!`);
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Couldn't save the routine.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRun() {
    const keeper = keeperRef.current;
    const snapshot = keeper.snapshot();
    if (snapshot.frames === 0) {
      setNotice("Nothing was scored yet. Start the track and dance along first.");
      return;
    }
    setBusy(true);
    let saved: SubmitRunResponse | null = null;
    let saveError: string | null = null;
    try {
      saved = await api.submitRun(
        keeper.toRunRequest({
          videoId: track.videoId,
          playlistId: track.playlistId,
          title: track.title,
          durationMs: videoDurationMs(),
        })
      );
    } catch (error) {
      saveError = error instanceof Error ? error.message : "Couldn't save this run.";
    } finally {
      setBusy(false);
    }
    onFinished({ track, snapshot, saved, saveError });
  }

  async function finish() {
    pause();
    if (busy) return;
    if (mode === "record") await saveReference();
    else await submitRun();
  }
  useEffect(() => {
    finishRef.current = () => void finish();
  });

  const hasReference = Boolean(reference);
  const canStart = playerReady && !videoError && (mode === "record" || hasReference);
  const title = track.title ?? `Track ${track.index + 1}`;
  const cameraLabel =
    camera === "on"
      ? personVisible
        ? "● TRACKING"
        : "● STEP INTO FRAME"
      : camera === "starting"
        ? "● STARTING…"
        : "● OFFLINE";

  return (
    <main className="dance-screen page-wrap">
      <div className="dance-topline">
        <button className="back-button" onClick={onBack}>
          ← BACK TO TRACKS
        </button>
        <div className="mode-switch" role="group" aria-label="Session mode">
          <button
            className={mode === "play" ? "active" : ""}
            onClick={() => switchMode("play")}
            disabled={!hasReference || playing || busy}
            title={hasReference ? undefined : "Record the routine first"}
          >
            DANCE FOR SCORE
          </button>
          <button
            className={mode === "record" ? "active record" : ""}
            onClick={() => switchMode("record")}
            disabled={playing || busy}
          >
            {hasReference ? "RE-RECORD ROUTINE" : "RECORD ROUTINE"}
          </button>
        </div>
      </div>

      <section className="dance-title-row">
        <div>
          <div className="eyebrow">{playlistName.toUpperCase()}</div>
          <h1 className="dance-title">{title.toUpperCase()}</h1>
          <p className="muted">
            {track.author ?? "YouTube"} <span className="heading-slash">/</span>{" "}
            {formatTime(positionMs)}
          </p>
        </div>
        <span className={`routine-badge large ${hasReference ? "ready" : "missing"}`}>
          {reference === undefined
            ? "LOADING ROUTINE…"
            : hasReference
              ? "ROUTINE READY"
              : "NO ROUTINE YET"}
        </span>
      </section>

      {mode === "record" && (
        <div className="mode-banner record">
          <strong>REFERENCE RECORDING</strong>
          <span>
            Dance the routine along with the video. Every move you make is saved as the target
            pose for later attempts — {REFERENCE_SAMPLE_RATE_HZ} poses a second, keyed to the
            video's clock.
          </span>
        </div>
      )}
      {mode === "play" && reference === null && !referenceError && (
        <div className="mode-banner">
          <strong>NO ROUTINE YET</strong>
          <span>Someone needs to record this routine before it can be scored.</span>
        </div>
      )}
      {referenceError && (
        <p className="form-error" role="alert">
          {referenceError}
        </p>
      )}

      <div className="dance-layout">
        <section className="video-stage" style={{ "--accent": accent } as React.CSSProperties}>
          <div className="stage-topbar">
            <span>
              <span className="status-dot" /> COACH VIEW
            </span>
            <span>TRACK {String(track.index + 1).padStart(2, "0")}</span>
          </div>
          <div className="dance-video-frame">
            <div className="dance-video-host" ref={playerHostRef} />
            {countdown !== null && (
              <div className="countdown" key={countdown}>
                {countdown}
              </div>
            )}
          </div>
          {!playerReady && !videoError && (
            <p className="playlist-status">Connecting to YouTube…</p>
          )}
          {videoError && (
            <div className="playlist-player-error" role="alert">
              <strong>CAN'T PLAY THIS TRACK</strong>
              <p>{videoError}</p>
              <button className="text-button" onClick={onBack}>
                PICK ANOTHER TRACK ↗
              </button>
            </div>
          )}
          <div className="playlist-controls">
            {playing || countdown !== null ? (
              <button className="primary-button" onClick={pause}>
                PAUSE <span>Ⅱ</span>
              </button>
            ) : (
              <button className="primary-button" onClick={() => void start()} disabled={!canStart || busy}>
                {positionMs > 0 ? "RESUME" : mode === "record" ? "START RECORDING" : "START DANCE"}{" "}
                <span>▶</span>
              </button>
            )}
            <button className="secondary-button" onClick={restart} disabled={!playerReady || busy}>
              RESTART <span>↺</span>
            </button>
            <button
              className="secondary-button"
              onClick={() => void finish()}
              disabled={busy || (mode === "record" ? recordedFrames === 0 : live.frames === 0)}
            >
              {busy ? "SAVING…" : mode === "record" ? "SAVE ROUTINE" : "FINISH & SCORE"} <span>↗</span>
            </button>
          </div>
          {notice && <p className="stage-notice">{notice}</p>}
        </section>

        <aside className="player-stage">
          <div className="player-stage-header">
            <span>PLAYER CAMERA</span>
            <span className={`camera-indicator ${camera === "on" && personVisible ? "live" : ""}`}>
              {cameraLabel}
            </span>
          </div>

          <div className="camera-view">
            <div className="camera-mirror">
              <video ref={webcamRef} className="webcam" playsInline muted />
              <canvas ref={canvasRef} className="pose-canvas" />
            </div>
            {camera !== "on" && (
              <div className="camera-placeholder overlay">
                <div className="camera-frame">
                  <span className="camera-cross">＋</span>
                  <span className="camera-person">♙</span>
                </div>
                <strong>{camera === "starting" ? "WAKING UP THE TRACKER…" : "YOUR SPOTLIGHT"}</strong>
                <p>
                  {camera === "error"
                    ? cameraError
                    : "Stand back so your whole upper body — ideally head to knees — is in view."}
                </p>
                {camera !== "starting" && (
                  <button className="text-button" onClick={() => void enableCamera()}>
                    ENABLE CAMERA ↗
                  </button>
                )}
              </div>
            )}
            {flash && mode === "play" && (
              <span key={flash.id} className={`tier-flash tier-${flash.tier.toLowerCase()}`}>
                {flash.tier}
              </span>
            )}
          </div>

          {mode === "play" ? (
            <>
              <div className="score-preview">
                <span>LIVE SCORE</span>
                <strong>{live.points.toLocaleString()}</strong>
                <small>
                  {live.combo > 1 ? `${live.combo}× COMBO` : live.frames ? "KEEP MOVING" : "WARM UP THOSE MOVES"}
                </small>
              </div>
              <div className="accuracy-meter" aria-label="Accuracy">
                <div className="accuracy-bar">
                  <span style={{ width: `${Math.round(live.accuracy * 100)}%` }} />
                </div>
                <small>
                  ACCURACY {Math.round(live.accuracy * 100)}% · BEST COMBO {live.maxCombo}
                </small>
              </div>
            </>
          ) : (
            <div className="score-preview">
              <span>POSES CAPTURED</span>
              <strong>{recordedFrames.toLocaleString()}</strong>
              <small>
                {recordedFrames >= MIN_REFERENCE_FRAMES
                  ? "READY TO SAVE"
                  : `${MIN_REFERENCE_FRAMES - recordedFrames} MORE TO SAVE`}
              </small>
            </div>
          )}
          <p className="pose-legend">
            <span className="dot good" /> ON IT <span className="dot close" /> CLOSE{" "}
            <span className="dot off" /> OFF
          </p>
        </aside>
      </div>
      <p className="dance-disclaimer">
        Pose tracking runs entirely in your browser. Only the scored summary
        {mode === "record" ? " and the routine's joint angles are" : " is"} sent to the server — never
        video.
      </p>
    </main>
  );
}
