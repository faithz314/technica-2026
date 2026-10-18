/**
 * Resolves a YouTube playlist into its tracks without a Data API key.
 *
 * A throwaway, off-screen IFrame player loads the playlist and reports its
 * video ids; titles then come from the API's oEmbed proxy. Ids are cached for
 * the browser session so revisiting the library doesn't spin up a player.
 */

import { api } from "./api";
import { thumbnailUrl } from "./shared/playlists";
import { createPlayer } from "./youtube";

export type Track = {
  videoId: string;
  playlistId: string;
  /** Position in the playlist, from 0. */
  index: number;
  title: string | null;
  author: string | null;
  thumbnailUrl: string;
};

const ID_TIMEOUT_MS = 15_000;
const POLL_MS = 250;
const STORAGE_PREFIX = "move:playlist:";

const inflight = new Map<string, Promise<string[]>>();

function readCachedIds(playlistId: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + playlistId);
    const ids: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(ids) && ids.length > 0 ? (ids as string[]) : null;
  } catch {
    return null;
  }
}

function fetchIdsFromPlayer(playlistId: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    // Off-screen rather than display:none, which stops the player initialising.
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:200px;height:113px;";
    const mount = document.createElement("div");
    host.appendChild(mount);
    document.body.appendChild(host);

    let player: Awaited<ReturnType<typeof createPlayer>> | null = null;
    let poll = 0;
    const timeout = window.setTimeout(
      () => finish(new Error("YouTube took too long to list this playlist.")),
      ID_TIMEOUT_MS
    );

    function finish(result: string[] | Error) {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      player?.destroy();
      host.remove();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    createPlayer(mount, {
      width: 200,
      height: 113,
      playerVars: { listType: "playlist", list: playlistId, autoplay: 0 },
      events: {
        onReady: (event) => {
          // The id list can trail `onReady` by a moment.
          poll = window.setInterval(() => {
            const ids = event.target.getPlaylist();
            if (ids && ids.length > 0) finish(ids);
          }, POLL_MS);
        },
      },
    })
      .then((created) => {
        player = created;
      })
      .catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

export function loadPlaylistVideoIds(playlistId: string): Promise<string[]> {
  const cached = readCachedIds(playlistId);
  if (cached) return Promise.resolve(cached);

  let pending = inflight.get(playlistId);
  if (!pending) {
    pending = fetchIdsFromPlayer(playlistId)
      .then((ids) => {
        try {
          sessionStorage.setItem(STORAGE_PREFIX + playlistId, JSON.stringify(ids));
        } catch {
          // Storage full or disabled: the in-memory promise still dedupes.
        }
        return ids;
      })
      .finally(() => inflight.delete(playlistId));
    inflight.set(playlistId, pending);
  }
  return pending;
}

export async function loadPlaylistTracks(playlistId: string): Promise<Track[]> {
  const ids = await loadPlaylistVideoIds(playlistId);
  // Titles are a nicety: if the proxy is down, show the tracks untitled.
  const meta = await api.videos(ids).catch(() => []);
  const byId = new Map(meta.map((entry) => [entry.videoId, entry]));
  return ids.map((videoId, index) => ({
    videoId,
    playlistId,
    index,
    title: byId.get(videoId)?.title ?? null,
    author: byId.get(videoId)?.author ?? null,
    thumbnailUrl: thumbnailUrl(videoId),
  }));
}
