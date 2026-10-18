/**
 * Titles for videos and playlists from YouTube's keyless oEmbed endpoint.
 *
 * Results are cached in memory: titles rarely change and the library asks for
 * the same few dozen ids on every visit.
 */

import type { VideoMeta } from "../../src/shared/apiTypes.ts";
import { thumbnailUrl } from "../../src/shared/playlists.ts";

const OEMBED_URL = "https://www.youtube.com/oembed";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const CONCURRENCY = 6;

type OEmbed = { title: string | null; author: string | null };

const cache = new Map<string, { value: OEmbed; expiresAt: number }>();

async function fetchOEmbed(targetUrl: string): Promise<OEmbed> {
  const cached = cache.get(targetUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: OEmbed = { title: null, author: null };
  let ttl = FAILURE_TTL_MS;
  try {
    const url = `${OEMBED_URL}?format=json&url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.ok) {
      const body = (await response.json()) as { title?: unknown; author_name?: unknown };
      value = {
        title: typeof body.title === "string" ? body.title : null,
        author: typeof body.author_name === "string" ? body.author_name : null,
      };
      ttl = CACHE_TTL_MS;
    }
  } catch {
    // Network failure or timeout: fall through with nulls and a short TTL.
  }
  cache.set(targetUrl, { value, expiresAt: Date.now() + ttl });
  return value;
}

/** Callers must validate ids first; the result preserves input order. */
export async function videoMeta(videoIds: string[]): Promise<VideoMeta[]> {
  const results: VideoMeta[] = new Array(videoIds.length);
  let next = 0;
  async function worker() {
    while (next < videoIds.length) {
      const index = next++;
      const videoId = videoIds[index];
      const meta = await fetchOEmbed(`https://www.youtube.com/watch?v=${videoId}`);
      results[index] = { videoId, ...meta, thumbnailUrl: thumbnailUrl(videoId) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, videoIds.length) }, worker));
  return results;
}

export async function playlistTitle(playlistId: string): Promise<string | null> {
  const meta = await fetchOEmbed(`https://www.youtube.com/playlist?list=${playlistId}`);
  return meta.title;
}
