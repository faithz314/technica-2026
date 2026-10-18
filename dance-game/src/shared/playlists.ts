/**
 * The real YouTube playlists the game plays from.
 *
 * Track listings are not hard-coded. The IFrame player reports the video ids in
 * a playlist at runtime, and titles come from YouTube's keyless oEmbed endpoint
 * via the API's `/api/videos` proxy. Nothing here needs a YouTube Data API key.
 *
 * The API treats this as an allowlist so its oEmbed proxy cannot be pointed at
 * arbitrary playlists.
 */

export type PlaylistConfig = {
  /** YouTube playlist id (the `list=` query parameter). */
  id: string;
  /** Shown until oEmbed reports the playlist's own title. */
  fallbackName: string;
  /** Short line under the playlist name in the library. */
  blurb: string;
  /** Drives the card's accent colour. */
  accent: string;
  symbol: string;
};

export const PLAYLISTS: readonly PlaylistConfig[] = [
  {
    id: "PLpy_XRdn544qr4Tg4rhJ47l9q6GxHSDF6",
    fallbackName: "Just Dance+ | All-time Classics",
    blurb: "Iconic routines. Legendary tracks.",
    accent: "#ff4e91",
    symbol: "✳",
  },
  {
    id: "PLpy_XRdn544rI45Dz-QfFQ58421XOb8mU",
    fallbackName: "Just Dance 2014 Gameplay",
    blurb: "The year the party peaked.",
    accent: "#37d9ee",
    symbol: "✺",
  },
];

export const DEFAULT_PLAYLIST_ID = PLAYLISTS[0].id;

/** YouTube video ids are 11 characters of URL-safe base64. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}

export function isKnownPlaylistId(value: string): boolean {
  return PLAYLISTS.some((playlist) => playlist.id === value);
}

export function findPlaylist(id: string): PlaylistConfig | undefined {
  return PLAYLISTS.find((playlist) => playlist.id === id);
}

/** Thumbnail URL for a video id. Served by YouTube without any API key. */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
