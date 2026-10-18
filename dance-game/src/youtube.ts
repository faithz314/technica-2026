/**
 * Thin, typed wrapper around the YouTube IFrame Player API.
 *
 * No YouTube Data API key is involved: the iframe player can load a whole
 * playlist by id and report its video ids, and the dance stage reads the
 * playback position straight off the player to time-align pose scoring.
 */

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const SCRIPT_ID = "youtube-iframe-api";

/** Values returned by `getPlayerState()`. */
export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export type YouTubeVideoData = {
  video_id: string;
  title: string;
  author: string;
};

export type YouTubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  previousVideo(): void;
  playVideoAt(index: number): void;
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  getVideoData(): YouTubeVideoData;
  getPlayerState(): number;
  /** Seconds into the current video. */
  getCurrentTime(): number;
  /** Seconds; 0 until the video's metadata has loaded. */
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  cueVideoById(videoId: string): void;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};

export type YouTubePlayerEvent = { target: YouTubePlayer };
export type YouTubeDataEvent = { target: YouTubePlayer; data: number };

export type YouTubePlayerOptions = {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: {
    listType?: "playlist" | "user_uploads";
    list?: string;
    autoplay?: 0 | 1;
    controls?: 0 | 1;
    disablekb?: 0 | 1;
    fs?: 0 | 1;
    iv_load_policy?: 1 | 3;
    rel?: 0 | 1;
    modestbranding?: 0 | 1;
    playsinline?: 0 | 1;
    origin?: string;
  };
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubeDataEvent) => void;
    onError?: (event: YouTubeDataEvent) => void;
  };
};

type YouTubeNamespace = {
  Player: new (
    element: HTMLElement | string,
    options: YouTubePlayerOptions
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
    /**
     * Cached loader promise. Parked on `window` rather than in module scope so
     * a Vite HMR update (which re-evaluates this module) does not re-inject
     * the script tag.
     */
    __youTubeIframeApiPromise?: Promise<YouTubeNamespace>;
  }
}

/**
 * Injects https://www.youtube.com/iframe_api exactly once and resolves with the
 * `YT` namespace once the API has signalled that it is ready. Safe to call from
 * several components, from StrictMode's double effect run, and across HMR.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (window.__youTubeIframeApiPromise) return window.__youTubeIframeApiPromise;

  const promise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("The YouTube player API loaded without a Player."));
      }
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) return; // Another caller already started the load.

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.addEventListener("error", () => {
      // Allow a later attempt to re-inject after a network failure.
      script.remove();
      delete window.__youTubeIframeApiPromise;
      reject(
        new Error(
          "Couldn't reach YouTube to load the player. Check your connection and retry."
        )
      );
    });

    document.head.appendChild(script);
  });

  window.__youTubeIframeApiPromise = promise;
  return promise;
}

/**
 * Waits for the API, then constructs a player that takes over `container`.
 *
 * The returned player is resolved as soon as it is constructed rather than on
 * `onReady`, so the caller always has a handle to `destroy()` even when the
 * player never becomes ready (for example when the first playlist item is
 * unavailable). Use `options.events.onReady` to know when commands are safe.
 */
export async function createPlayer(
  container: HTMLElement,
  options: YouTubePlayerOptions
): Promise<YouTubePlayer> {
  const YT = await loadYouTubeIframeApi();
  return new YT.Player(container, options);
}

/** Human-readable text for the numeric codes passed to `onError`. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return "YouTube rejected the request for this video (invalid id).";
    case 5:
      return "This video can't be played in the HTML5 player.";
    case 100:
      return "This video was removed or is private.";
    case 101:
    case 150:
      return "The uploader doesn't allow this video to be embedded.";
    default:
      return `YouTube reported playback error ${code}.`;
  }
}
