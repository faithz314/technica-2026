export type YouTubePlaylistVideo = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
};

type YouTubePlaylistResponse = {
  nextPageToken?: string;
  items?: {
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: {
        medium?: { url?: string };
        high?: { url?: string };
        default?: { url?: string };
      };
      resourceId?: {
        videoId?: string;
      };
    };
  }[];
};

export async function getPlaylistVideos(
  playlistId: string
): Promise<YouTubePlaylistVideo[]> {
//   const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

//   if (!apiKey) {
//     throw new Error("Add VITE_YOUTUBE_API_KEY to .env.local");
//   }

  const videos: YouTubePlaylistVideo[] = [];
  let pageToken = "";

  // Fetch up to 100 videos (two pages of 50).
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({
      part: "snippet",
      playlistId,
      maxResults: "50",
    //   key: apiKey,
    });

    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        error?.error?.message || "Couldn't load this YouTube playlist."
      );
    }

    const data: YouTubePlaylistResponse = await response.json();

    for (const item of data.items ?? []) {
      const snippet = item.snippet;
      const videoId = snippet?.resourceId?.videoId;
      const title = snippet?.title;

      // Skip deleted or unavailable playlist entries.
      if (!videoId || !title || title === "Deleted video" ||
          title === "Private video") continue;

      const thumbnails = snippet?.thumbnails;

      videos.push({
        id: videoId,
        title,
        channelTitle: snippet?.channelTitle || "YouTube",
        thumbnail:
          thumbnails?.high?.url ||
          thumbnails?.medium?.url ||
          thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return videos;
}
